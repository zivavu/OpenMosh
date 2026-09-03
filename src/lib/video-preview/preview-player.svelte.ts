import type { InputAudioTrack } from "mediabunny";
import { openAudioTrack, type FrameQueue } from "../video/decode";
import { openVideoFrameSource } from "../video/frame-source";

/** If decode falls this far (media seconds) behind the clock, keyframe-jump. */
const MAX_DECODE_LAG = 1;
/** Matches the editor's VIDEO_END_EPSILON: a position this close to the span
 * end counts as being at it. */
const SPAN_END_EPSILON = 0.1;

/**
 * WebCodecs-based video preview playback (via mediabunny), replacing the
 * <video> element as the preview frame source. The element stalls at high
 * playbackRate (decode underrun, unreliable ended/timeupdate); here the clock
 * is plain arithmetic that cannot stall.
 *
 * The decode pump runs flat-out into a small ready-queue — no timer-based
 * pacing, which cannot keep up above ~2× (frames due every few ms vs. 4-16ms
 * timer jitter). Frame selection happens synchronously in `takeFrame` on the
 * render loop: newest due sample wins, older due samples are discarded.
 *
 * Eligibility mirrors the export path: no rotation metadata and a decodable
 * codec, otherwise `create` returns null and the caller falls back to the
 * <video> element.
 */
export class VideoPreviewPlayer {
  // Reactive playback state, read by the editor UI
  currentTime = $state(0);
  playing = $state(false);

  readonly duration: number;
  /** The media's own size, which is what an export writes. */
  readonly width: number;
  readonly height: number;
  /** Size the frames arrive at — smaller than the media for a large source. */
  readonly frameWidth: number;
  readonly frameHeight: number;

  /** Whether looping at the span end is enabled (set by the editor). */
  loop = true;

  #queue: FrameQueue;
  #spanStart = 0;
  #spanEnd: number;
  #speed = 1;
  /** Set while the position sits past the end of the span. The span is an
   * export selection, not a fence: a run started beyond it plays out the video
   * rather than being pulled back to the span. */
  #pastSpan = false;
  #muted = false;
  #disposed = false;

  // Wall-clock → media-time mapping. While playing, media time is
  // baseMedia + elapsed wall time × speed; while paused it's just baseMedia.
  #baseMedia = 0;
  #baseWall = 0;

  // Video-source audio, decoded once into a buffer and played through the
  // editor's Web Audio graph so volume links / analysis keep working.
  #audioBuffer: AudioBuffer | null = null;
  #audioCtx: AudioContext | null = null;
  #audioDest: AudioNode | null = null;
  #audioSrc: AudioBufferSourceNode | null = null;

  private constructor(
    queue: FrameQueue,
    width: number,
    height: number,
    frameWidth: number,
    frameHeight: number,
    duration: number,
  ) {
    this.#queue = queue;
    this.width = width;
    this.height = height;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.duration = duration;
    this.#spanEnd = duration;
  }

  /** Returns null when the file can't drive the WebCodecs preview path. */
  static async create(
    file: File,
    /**
     * The original media's size and duration, when `file` is a preview proxy:
     * frames arrive at the proxy's smaller size, but the media's own size is
     * what the UI reports and what the output defaults to, and the clock is
     * anchored to the original's duration.
     */
    media?: { width: number; height: number; duration: number },
  ): Promise<VideoPreviewPlayer | null> {
    const opened = await openVideoFrameSource(file);
    if (!opened) return null;

    const player = new VideoPreviewPlayer(
      opened.queue,
      media?.width || opened.width,
      media?.height || opened.height,
      opened.frameWidth,
      opened.frameHeight,
      media?.duration || opened.duration,
    );

    // Decode the audio track in the background; playback starts silent and
    // sound joins in once ready (usually well under a second). Its own input:
    // the video is decoded elsewhere (a worker, usually), and this one is
    // finished with the moment the buffer exists.
    void (async () => {
      const audio = await openAudioTrack(file);
      if (!audio) return;
      try {
        const buffer = await decodeAudioTrackToBuffer(audio.track);
        if (player.#disposed || !buffer) return;
        player.#audioBuffer = buffer;
        if (player.playing) player.#startAudio();
      } catch {
        // Silent preview; export decodes audio separately
      } finally {
        audio.input.dispose();
      }
    })();

    player.#queue.start(0);
    return player;
  }

  /**
   * Route this player's audio into an existing Web Audio graph. Safe to call
   * before the audio buffer has finished decoding.
   */
  attachAudioOutput(context: AudioContext, destination: AudioNode) {
    if (this.#audioCtx && this.#audioCtx !== context) {
      this.#audioCtx.removeEventListener("statechange", this.#onContextState);
    }
    this.#audioCtx = context;
    this.#audioDest = destination;
    context.addEventListener("statechange", this.#onContextState);
    if (this.playing) this.#startAudio();
  }

  // resume() is async, so the context is usually still suspended when play()
  // starts audio synchronously right after it. The media clock is wall-clock
  // based and keeps running regardless, so a buffer source scheduled while
  // suspended resumes at a stale offset, behind the video. Restart from the
  // current media time once the context is actually running.
  #onContextState = () => {
    if (this.#audioCtx?.state === "running" && this.playing) this.#startAudio();
  };

  play() {
    if (this.#disposed || this.playing) return;
    this.#pastSpan = this.#isPastSpan(this.#baseMedia);
    this.#baseWall = performance.now();
    this.playing = true;
    this.#startAudio();
  }

  pause() {
    if (!this.playing) return;
    this.#baseMedia = this.#clampedTime();
    this.playing = false;
    this.currentTime = this.#baseMedia;
    this.#stopAudio();
  }

  seek(t: number) {
    if (this.#disposed) return;
    this.#setPosition(Math.max(0, Math.min(this.duration, t)));
  }

  setSpeed(speed: number) {
    if (speed === this.#speed) return;
    // Rebase the clock so the speed change doesn't jump the position
    this.#baseMedia = this.#clampedTime();
    this.#baseWall = performance.now();
    this.#speed = speed;
    if (this.playing) this.#startAudio();
  }

  setSpan(start: number, end: number) {
    this.#spanStart = start;
    this.#spanEnd = end;
  }

  /** Muted while an explicit music track overrides the video's own audio. */
  setMuted(muted: boolean) {
    if (muted === this.#muted) return;
    this.#muted = muted;
    if (muted) this.#stopAudio();
    else if (this.playing) this.#startAudio();
  }

  /**
   * Advance the clock and return a newly due frame, or null to keep the
   * previous upload. Called once per rendered frame; the caller must close
   * the returned VideoFrame after uploading it.
   */
  takeFrame(): VideoFrame | null {
    if (this.#disposed) return null;
    this.#tickClock();
    const t = this.#mediaTimeNow();

    // Decoder can't keep up and has fallen far behind — jump to a keyframe
    // near the clock instead of grinding through every skipped frame.
    if (
      this.playing &&
      !this.#queue.done &&
      this.#queue.size === 0 &&
      t - this.#queue.head > MAX_DECODE_LAG
    ) {
      this.#queue.start(t);
      return null;
    }

    return this.#queue.takeDue(t);
  }

  dispose() {
    this.#disposed = true;
    this.playing = false;
    this.#stopAudio();
    this.#audioCtx?.removeEventListener("statechange", this.#onContextState);
    this.#queue.dispose();
  }

  /** End of the span, or of the video when playback started past the span. */
  #end(): number {
    if (this.#pastSpan) return this.duration;
    const end = this.#spanEnd > 0 ? this.#spanEnd : this.duration;
    return Math.min(end, this.duration);
  }

  #isPastSpan(t: number): boolean {
    const end = this.#spanEnd > 0 ? this.#spanEnd : this.duration;
    return t >= Math.min(end, this.duration) - SPAN_END_EPSILON;
  }

  #mediaTimeNow(): number {
    return this.playing
      ? this.#baseMedia +
          ((performance.now() - this.#baseWall) / 1000) * this.#speed
      : this.#baseMedia;
  }

  #clampedTime(): number {
    return Math.max(0, Math.min(this.duration, this.#mediaTimeNow()));
  }

  #tickClock() {
    const t = this.#mediaTimeNow();
    if (this.playing && t >= this.#end()) {
      if (this.loop) {
        this.#setPosition(this.#spanStart);
      } else {
        this.playing = false;
        this.#baseMedia = this.#end();
        this.currentTime = this.#baseMedia;
        this.#stopAudio();
      }
      return;
    }
    this.currentTime = Math.min(t, this.duration);
  }

  #setPosition(t: number) {
    this.#pastSpan = this.#isPastSpan(t);
    this.#baseMedia = t;
    this.#baseWall = performance.now();
    this.currentTime = t;
    this.#queue.start(t);
    if (this.playing) this.#startAudio();
  }

  #startAudio() {
    this.#stopAudio();
    if (
      this.#muted ||
      !this.playing ||
      !this.#audioBuffer ||
      !this.#audioCtx ||
      !this.#audioDest
    ) {
      return;
    }
    // Covers entry points that don't resume the context themselves, e.g. the
    // space-bar play shortcut; a no-op when it is already running.
    if (this.#audioCtx.state === "suspended") {
      void this.#audioCtx.resume().catch(() => {});
    }
    const t = this.#mediaTimeNow();
    if (t >= this.#audioBuffer.duration) return;
    const node = this.#audioCtx.createBufferSource();
    node.buffer = this.#audioBuffer;
    node.playbackRate.value = this.#speed;
    node.connect(this.#audioDest);
    node.start(0, Math.max(0, t));
    this.#audioSrc = node;
  }

  #stopAudio() {
    if (!this.#audioSrc) return;
    try {
      this.#audioSrc.stop();
    } catch {
      // Not started yet — fine
    }
    this.#audioSrc.disconnect();
    this.#audioSrc = null;
  }
}

/** Decode a full audio track into a single AudioBuffer for Web Audio playback. */
async function decodeAudioTrackToBuffer(
  track: InputAudioTrack,
): Promise<AudioBuffer | null> {
  const { AudioBufferSink } = await import("mediabunny");
  const duration = await track.computeDuration();
  if (!Number.isFinite(duration) || duration <= 0) return null;

  // The output buffer's rate/channels come from the first decoded chunk, not
  // from the container metadata: mediabunny reads MP4/AAC's rate from the base
  // samplingFrequencyIndex in the AudioSpecificConfig, which for HE-AAC is half
  // the decoder's real output rate (SBR) — and channelConfiguration reads 1 for
  // HE-AAC v2 despite stereo output (PS). Sizing from those values wrote every
  // chunk at half its true offset into a half-rate buffer, so video-source
  // audio played back slowed down and overlapping. Opus (WebM) is always 48 kHz
  // and so never tripped this.
  let out: AudioBuffer | null = null;
  let sampleRate = 0;
  let channels = 0;
  let length = 0;

  const sink = new AudioBufferSink(track);
  for await (const { buffer, timestamp } of sink.buffers()) {
    if (!out) {
      sampleRate = buffer.sampleRate;
      channels = buffer.numberOfChannels;
      if (!sampleRate || !channels) return null;
      length = Math.ceil(duration * sampleRate);
      out = new AudioBuffer({ numberOfChannels: channels, length, sampleRate });
    }
    const offset = Math.round(timestamp * sampleRate);
    if (offset >= length) break;
    const room = length - offset;
    for (let ch = 0; ch < channels; ch++) {
      const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      out.copyToChannel(src.length > room ? src.subarray(0, room) : src, ch, offset);
    }
  }
  return out;
}
