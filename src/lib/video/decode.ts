import type {
  Input,
  InputAudioTrack,
  InputVideoTrack,
  VideoSample,
  VideoSampleSink,
} from "mediabunny";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Decode-ahead queue depth; absorbs consumer/decoder cadence mismatch. */
export const QUEUE_DEPTH = 8;

/**
 * Frames every queue has produced, for the preview's FPS overlay. Counted here
 * rather than per player so the reading means the same thing whichever path
 * the preview is on — one video, a sequence segment, or a media lane.
 */
export const decodeStats = { frames: 0 };

export interface DecodableVideo {
  /** Kept open so callers can reach other tracks (e.g. the audio track). */
  input: Input;
  track: InputVideoTrack;
  sink: VideoSampleSink;
}

export interface PlayableVideo extends DecodableVideo {
  duration: number;
  width: number;
  height: number;
}

/**
 * Open a file's primary video track for WebCodecs decoding, or null when the
 * file can't drive that path. Rotation metadata is applied by the <video>
 * element but not to raw decoded frames, so rotated files fall back to the
 * element everywhere that uses this.
 */
export async function openDecodableVideo(
  file: File,
): Promise<DecodableVideo | null> {
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({
      source: new mb.BlobSource(file),
      formats: mb.ALL_FORMATS,
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track || track.rotation !== 0 || !(await track.canDecode())) {
      return null;
    }
    return { input, track, sink: new mb.VideoSampleSink(track) };
  } catch {
    return null;
  }
}

/**
 * As openDecodableVideo, but also resolves the dimensions and duration a
 * player/sampler needs to drive playback — null when any of them is unusable.
 */
export async function openPlayableVideo(
  file: File,
): Promise<PlayableVideo | null> {
  try {
    const opened = await openDecodableVideo(file);
    if (!opened) return null;
    const duration = await opened.track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const width = opened.track.displayWidth;
    const height = opened.track.displayHeight;
    if (width <= 0 || height <= 0) return null;
    return { ...opened, duration, width, height };
  } catch {
    return null;
  }
}

/**
 * Open a file's primary audio track. The input is the caller's to dispose once
 * it has read what it needs — nothing else here holds it.
 */
export async function openAudioTrack(
  file: File,
): Promise<{ input: Input; track: InputAudioTrack } | null> {
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({
      source: new mb.BlobSource(file),
      formats: mb.ALL_FORMATS,
    });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    return { input, track };
  } catch {
    return null;
  }
}

/** Convert a decoded sample to a VideoFrame and release the sample. */
export function toVideoFrame(sample: VideoSample): VideoFrame {
  const frame = sample.toVideoFrame();
  sample.close();
  return frame;
}

/**
 * A bounded queue of decoded frames fed by a decode pump, drained
 * synchronously by a render loop. Implemented on the main thread by
 * `SampleQueue` and off it by `WorkerFrameQueue` — see `openVideoFrameSource`,
 * which picks between them.
 *
 * Timestamps are seconds throughout the interface, matching the clocks the
 * consumers keep. Frames handed out are the caller's to close.
 */
export interface FrameQueue {
  /** True once the source is exhausted and no more frames will arrive. */
  readonly done: boolean;
  readonly started: boolean;
  readonly size: number;
  /** Timestamp of the newest decoded frame — how far ahead the decoder is. */
  readonly head: number;
  /** Frames that have landed since the queue was created, for a decode rate. */
  readonly received: number;
  /** (Re)start decoding from `startTime`, dropping anything already queued. */
  start(startTime: number): void;
  /**
   * The newest frame due at `t`. Older due frames are stale and dropped, so a
   * consumer that falls behind catches up instead of playing in slow motion.
   */
  takeDue(t: number): VideoFrame | null;
  /** The queue head regardless of its timestamp; null when the queue is empty. */
  takeHead(): VideoFrame | null;
  dispose(): void;
}

/**
 * Main-thread decode pump feeding a bounded ready-queue — the fallback for
 * browsers where the worker path can't be used.
 *
 * Decoding runs flat-out into the queue and parks only while it is full, woken
 * by the next consumer take rather than by a timer. A poll interval here is a
 * floor on how fast the queue can refill: at 165 Hz a consumer drains a
 * QUEUE_DEPTH queue in well under the poll, so the decoder ends up idling on a
 * timer while the preview starves — with no CPU or GPU load to show for it.
 * Consumers pull synchronously from the queue on their own cadence.
 */
export class SampleQueue implements FrameQueue {
  #sink: VideoSampleSink;
  #depth: number;
  #frames: VideoFrame[] = [];
  /** Bumping cancels the in-flight pump loop. */
  #genId = 0;
  #started = false;
  #done = false;
  #disposed = false;
  #head = 0;
  #received = 0;
  /** Resolver for a pump parked on a full queue; null when it isn't parked. */
  #room: (() => void) | null = null;

  constructor(sink: VideoSampleSink, depth = QUEUE_DEPTH) {
    this.#sink = sink;
    this.#depth = depth;
  }

  get done() {
    return this.#done;
  }

  get started() {
    return this.#started;
  }

  get size() {
    return this.#frames.length;
  }

  get head() {
    return this.#head;
  }

  get received() {
    return this.#received;
  }

  start(startTime: number) {
    this.#clear();
    this.#started = true;
    void this.#pump(startTime);
  }

  takeDue(t: number): VideoFrame | null {
    let chosen: VideoFrame | null = null;
    while (this.#frames.length > 0 && this.#frames[0].timestamp <= t * 1e6) {
      chosen?.close();
      chosen = this.#frames.shift()!;
    }
    if (chosen) this.#wake();
    return chosen;
  }

  takeHead(): VideoFrame | null {
    const frame = this.#frames.shift() ?? null;
    if (frame) this.#wake();
    return frame;
  }

  dispose() {
    this.#disposed = true;
    this.#genId++;
    this.#clear();
  }

  #clear() {
    for (const frame of this.#frames) frame.close();
    this.#frames = [];
    // Also covers cancellation: a parked pump has to run again to notice its
    // generation was retired, close the sample it is holding and return.
    this.#wake();
  }

  /** Let a parked pump re-check whether there is room to decode into. */
  #wake() {
    const resume = this.#room;
    if (!resume) return;
    this.#room = null;
    resume();
  }

  async #pump(startTime: number) {
    const id = ++this.#genId;
    this.#done = false;
    this.#head = startTime;
    try {
      for await (const sample of this.#sink.samples(startTime)) {
        while (
          id === this.#genId &&
          !this.#disposed &&
          this.#frames.length >= this.#depth
        ) {
          // Parked until a consumer frees a slot. A paused preview leaves this
          // waiting indefinitely, which is the point — no background timer per
          // idle lane — and dispose()/restart both wake it.
          await new Promise<void>((resolve) => (this.#room = resolve));
        }
        if (id !== this.#genId || this.#disposed) {
          sample.close();
          return;
        }
        this.#head = sample.timestamp;
        this.#received++;
        decodeStats.frames++;
        this.#frames.push(toVideoFrame(sample));
      }
      if (id === this.#genId) this.#done = true;
    } catch {
      // Decode failure mid-stream: keep the last good frame on screen
      if (id === this.#genId) this.#done = true;
    }
  }
}
