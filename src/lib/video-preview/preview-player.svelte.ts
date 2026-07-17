import type { InputAudioTrack, VideoSample, VideoSampleSink } from "mediabunny";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Decode-ahead queue depth; absorbs rAF/decoder cadence mismatch. */
const QUEUE_DEPTH = 8;
/** If decode falls this far (media seconds) behind the clock, keyframe-jump. */
const MAX_DECODE_LAG = 1;

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
  readonly width: number;
  readonly height: number;

  /** Whether looping at the span end is enabled (set by the editor). */
  loop = true;

  #videoSink: VideoSampleSink;
  #spanStart = 0;
  #spanEnd: number;
  #speed = 1;
  #muted = false;
  #disposed = false;

  // Wall-clock → media-time mapping. While playing, media time is
  // baseMedia + elapsed wall time × speed; while paused it's just baseMedia.
  #baseMedia = 0;
  #baseWall = 0;

  // Decode pump state. Bumping #genId cancels the previous pump loop.
  #genId = 0;
  #queue: VideoSample[] = [];
  /** Timestamp of the newest decoded sample — how far ahead the decoder is. */
  #decodeHead = 0;
  #pumpDone = false;

  // Video-source audio, decoded once into a buffer and played through the
  // editor's Web Audio graph so volume links / analysis keep working.
  #audioBuffer: AudioBuffer | null = null;
  #audioCtx: AudioContext | null = null;
  #audioDest: AudioNode | null = null;
  #audioSrc: AudioBufferSourceNode | null = null;

  private constructor(
    sink: VideoSampleSink,
    width: number,
    height: number,
    duration: number,
  ) {
    this.#videoSink = sink;
    this.width = width;
    this.height = height;
    this.duration = duration;
    this.#spanEnd = duration;
  }

  /** Returns null when the file can't drive the WebCodecs preview path. */
  static async create(file: File): Promise<VideoPreviewPlayer | null> {
    try {
      const mb = await import("mediabunny");
      const input = new mb.Input({
        source: new mb.BlobSource(file),
        formats: mb.ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      // Rotation metadata is applied by the <video> element but not by raw
      // decoded frames — same fallback rule as the export path.
      if (!track || track.rotation !== 0 || !(await track.canDecode())) {
        return null;
      }
      const duration = await track.computeDuration();
      if (!Number.isFinite(duration) || duration <= 0) return null;
      if (track.displayWidth <= 0 || track.displayHeight <= 0) return null;

      const player = new VideoPreviewPlayer(
        new mb.VideoSampleSink(track),
        track.displayWidth,
        track.displayHeight,
        duration,
      );

      // Decode the audio track in the background; playback starts silent and
      // sound joins in once ready (usually well under a second).
      void (async () => {
        try {
          const audioTrack = await input.getPrimaryAudioTrack();
          if (!audioTrack || !(await audioTrack.canDecode())) return;
          const buffer = await decodeAudioTrackToBuffer(audioTrack);
          if (player.#disposed || !buffer) return;
          player.#audioBuffer = buffer;
          if (player.playing) player.#startAudio();
        } catch {
          // Silent preview; export decodes audio separately
        }
      })();

      void player.#pump(0);
      return player;
    } catch {
      return null;
    }
  }

  /**
   * Route this player's audio into an existing Web Audio graph. Safe to call
   * before the audio buffer has finished decoding.
   */
  attachAudioOutput(context: AudioContext, destination: AudioNode) {
    this.#audioCtx = context;
    this.#audioDest = destination;
    if (this.playing) this.#startAudio();
  }

  play() {
    if (this.#disposed || this.playing) return;
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
      !this.#pumpDone &&
      this.#queue.length === 0 &&
      t - this.#decodeHead > MAX_DECODE_LAG
    ) {
      this.#restartPump(t);
      return null;
    }

    // Newest due sample wins; older due samples are stale — discard.
    let chosen: VideoSample | null = null;
    while (this.#queue.length > 0 && this.#queue[0].timestamp <= t) {
      chosen?.close();
      chosen = this.#queue.shift()!;
    }
    if (!chosen) return null;
    const frame = chosen.toVideoFrame();
    chosen.close();
    return frame;
  }

  dispose() {
    this.#disposed = true;
    this.#genId++;
    this.playing = false;
    this.#stopAudio();
    this.#clearQueue();
  }

  #end(): number {
    const end = this.#spanEnd > 0 ? this.#spanEnd : this.duration;
    return Math.min(end, this.duration);
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
    this.#baseMedia = t;
    this.#baseWall = performance.now();
    this.currentTime = t;
    this.#restartPump(t);
    if (this.playing) this.#startAudio();
  }

  #restartPump(t: number) {
    this.#clearQueue();
    void this.#pump(t);
  }

  #clearQueue() {
    for (const sample of this.#queue) sample.close();
    this.#queue = [];
  }

  /**
   * Sequential decode loop: fills the ready-queue as fast as the decoder
   * allows, parking only while the queue is full (paused, or decoder ahead).
   */
  async #pump(startTime: number) {
    const id = ++this.#genId;
    this.#pumpDone = false;
    this.#decodeHead = startTime;
    try {
      for await (const sample of this.#videoSink.samples(startTime)) {
        while (
          id === this.#genId &&
          !this.#disposed &&
          this.#queue.length >= QUEUE_DEPTH
        ) {
          await sleep(10);
        }
        if (id !== this.#genId || this.#disposed) {
          sample.close();
          return;
        }
        this.#queue.push(sample);
        this.#decodeHead = sample.timestamp;
      }
      if (id === this.#genId) this.#pumpDone = true;
    } catch {
      // Decode failure mid-stream: keep the last good frame on screen
      if (id === this.#genId) this.#pumpDone = true;
    }
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
  const sampleRate = track.sampleRate;
  const channels = track.numberOfChannels;
  const duration = await track.computeDuration();
  if (!sampleRate || !channels || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  const length = Math.ceil(duration * sampleRate);
  const out = new AudioBuffer({ numberOfChannels: channels, length, sampleRate });
  const sink = new AudioBufferSink(track);
  for await (const { buffer, timestamp } of sink.buffers()) {
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
