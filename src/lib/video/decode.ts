import type {
  Input,
  InputVideoTrack,
  VideoSample,
  VideoSampleSink,
} from "mediabunny";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Decode-ahead queue depth; absorbs consumer/decoder cadence mismatch. */
const QUEUE_DEPTH = 8;

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

/** Convert a decoded sample to a VideoFrame and release the sample. */
export function toVideoFrame(sample: VideoSample): VideoFrame {
  const frame = sample.toVideoFrame();
  sample.close();
  return frame;
}

/**
 * A decode pump feeding a bounded ready-queue, shared by the editor's preview
 * player and the slideshow's slide sampler.
 *
 * Decoding runs flat-out into the queue and parks only while it is full, woken
 * by the next consumer take rather than by a timer. A poll interval here is a
 * floor on how fast the queue can refill: at 165 Hz a consumer drains a
 * QUEUE_DEPTH queue in well under the poll, so the decoder ends up idling on a
 * timer while the preview starves — with no CPU or GPU load to show for it.
 * Consumers pull synchronously from the queue on their own cadence.
 */
export class SampleQueue {
  #sink: VideoSampleSink;
  #depth: number;
  #samples: VideoSample[] = [];
  /** Bumping cancels the in-flight pump loop. */
  #genId = 0;
  #started = false;
  #done = false;
  #disposed = false;
  /** Timestamp of the newest decoded sample — how far ahead the decoder is. */
  #head = 0;
  /** Resolver for a pump parked on a full queue; null when it isn't parked. */
  #room: (() => void) | null = null;

  constructor(sink: VideoSampleSink, depth = QUEUE_DEPTH) {
    this.#sink = sink;
    this.#depth = depth;
  }

  /** True once the source is exhausted and no more samples will arrive. */
  get done() {
    return this.#done;
  }

  get started() {
    return this.#started;
  }

  get size() {
    return this.#samples.length;
  }

  get head() {
    return this.#head;
  }

  /** (Re)start decoding from `startTime`, dropping anything already queued. */
  start(startTime: number) {
    this.clear();
    this.#started = true;
    void this.#pump(startTime);
  }

  /**
   * The newest sample due at `t`. Older due samples are stale and dropped, so
   * a consumer that falls behind catches up instead of playing in slow motion.
   */
  takeDue(t: number): VideoSample | null {
    let chosen: VideoSample | null = null;
    while (this.#samples.length > 0 && this.#samples[0].timestamp <= t) {
      chosen?.close();
      chosen = this.#samples.shift()!;
    }
    if (chosen) this.#wake();
    return chosen;
  }

  /** The queue head regardless of its timestamp; null when the queue is empty. */
  takeHead(): VideoSample | null {
    const sample = this.#samples.shift() ?? null;
    if (sample) this.#wake();
    return sample;
  }

  clear() {
    for (const sample of this.#samples) sample.close();
    this.#samples = [];
    // Also covers cancellation: a parked pump has to run again to notice its
    // generation was retired, close the sample it is holding and return.
    this.#wake();
  }

  dispose() {
    this.#disposed = true;
    this.#genId++;
    this.clear();
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
          this.#samples.length >= this.#depth
        ) {
          // Parked until a consumer frees a slot. A paused preview leaves this
          // waiting indefinitely, which is the point — no background timer per
          // idle lane — and clear()/dispose() both wake it.
          await new Promise<void>((resolve) => (this.#room = resolve));
        }
        if (id !== this.#genId || this.#disposed) {
          sample.close();
          return;
        }
        this.#samples.push(sample);
        this.#head = sample.timestamp;
      }
      if (id === this.#genId) this.#done = true;
    } catch {
      // Decode failure mid-stream: keep the last good frame on screen
      if (id === this.#genId) this.#done = true;
    }
  }
}
