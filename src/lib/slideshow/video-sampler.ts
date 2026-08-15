import {
  openPlayableVideo,
  SampleQueue,
  sleep,
  toVideoFrame,
} from "../video/decode";

export interface SlideVideoProbe {
  duration: number;
  width: number;
  height: number;
  /** First-frame thumbnail (cover-cropped square JPEG), or null if it failed. */
  thumb: Blob | null;
}

/**
 * Eligibility check for a video slide, mirroring the single-editor WebCodecs
 * rules (no rotation metadata, decodable codec). Also grabs duration,
 * dimensions and a first-frame thumbnail in the same pass.
 * Returns null when the file can't drive the WebCodecs path.
 */
export async function probeSlideVideo(
  file: File,
  thumbSize = 100,
): Promise<SlideVideoProbe | null> {
  const opened = await openPlayableVideo(file);
  if (!opened) return null;

  let thumb: Blob | null = null;
  try {
    const sample = await opened.sink.getSample(0);
    if (sample) {
      const frame = toVideoFrame(sample);
      thumb = await drawThumb(frame, thumbSize);
      frame.close();
    }
  } catch {
    // Thumbless slide is fine — grid shows the loading placeholder
  }
  return {
    duration: opened.duration,
    width: opened.width,
    height: opened.height,
    thumb,
  };
}

async function drawThumb(frame: VideoFrame, size: number): Promise<Blob | null> {
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  if (w <= 0 || h <= 0) return null;
  const scale = Math.max(size / w, size / h);
  const cropW = size / scale;
  const cropH = size / scale;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    frame,
    (w - cropW) / 2,
    (h - cropH) / 2,
    cropW,
    cropH,
    0,
    0,
    size,
    size,
  );
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}

/** Forward jump past this many seconds is seeked to rather than decoded through. */
const SEEK_AHEAD = 0.75;
/** Backward slack, so float noise in a clock doesn't trigger a seek. */
const BACK_EPS = 0.001;

/**
 * Frame sampler for a video slide, shared by preview and export.
 *
 * Unlike VideoPreviewPlayer there is no clock, audio or speed — the caller
 * states the position outright with `at(t)`, so the same time always yields the
 * same frame however the playhead got there. Decode still runs sequentially: a
 * position that creeps forward is served straight from the queue, and the pump
 * is restarted (a seek) only on a jump. It starts lazily on the first call, so
 * samplers for hidden slides hold no decoded frames.
 */
export class SlideVideoSampler {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  /** Where the sampler currently is, wrapped into [0, duration). */
  position = 0;

  #queue: SampleQueue;
  /** Whether a frame has been returned since the last (re)start at 0. */
  #delivered = false;
  /** Guards against overlapping at() calls from the preview rAF loop. */
  #busy = false;
  #disposed = false;

  private constructor(
    queue: SampleQueue,
    duration: number,
    width: number,
    height: number,
  ) {
    this.#queue = queue;
    this.duration = duration;
    this.width = width;
    this.height = height;
  }

  /** Returns null when the file can't drive the WebCodecs path. */
  static async create(file: File): Promise<SlideVideoSampler | null> {
    const opened = await openPlayableVideo(file);
    if (!opened) return null;
    return new SlideVideoSampler(
      new SampleQueue(opened.sink),
      opened.duration,
      opened.width,
      opened.height,
    );
  }

  /** Rewind to 0 so a fresh preview/export run starts deterministically. */
  reset() {
    this.position = 0;
    this.#delivered = false;
    if (this.#queue.started) this.#queue.start(0);
  }

  /**
   * Move to absolute position `t` (wrapped into the clip) and return the frame
   * due there, or null to keep the previous upload.
   *
   * This is what makes playback repeatable: the position is a function of the
   * caller's clock rather than of how many times it happened to call, so a
   * stalled frame, a paused preview and a playhead dropped into the middle of a
   * segment all land on the same frame the export will write.
   */
  async at(t: number): Promise<VideoFrame | null> {
    if (this.#disposed || this.duration <= 0) return null;
    if (this.#busy) return null;
    this.#busy = true;
    try {
      const want = ((t % this.duration) + this.duration) % this.duration;
      const delta = want - this.position;
      this.position = want;
      // Creeping forward is what the queue is for; anything else is a jump,
      // and re-pumping from there beats decoding through the gap.
      if (!this.#queue.started || delta < -BACK_EPS || delta > SEEK_AHEAD) {
        this.#delivered = false;
        this.#queue.start(want);
      }
      return await this.#take(want);
    } finally {
      this.#busy = false;
    }
  }

  /** The newest queued frame due at `t`; waits for decode if none has landed. */
  async #take(t: number): Promise<VideoFrame | null> {
    while (!this.#disposed) {
      const due = this.#queue.takeDue(t);
      if (due) {
        this.#delivered = true;
        return toVideoFrame(due);
      }
      if (this.#queue.size > 0) {
        // Head is in the future. If we've already shown a frame it's still
        // current; otherwise (first frame timestamp > t) show the head so
        // the slide isn't blank on its first beat.
        if (this.#delivered) return null;
        this.#delivered = true;
        return toVideoFrame(this.#queue.takeHead()!);
      }
      if (this.#queue.done) return null;
      await sleep(5);
    }
    return null;
  }

  dispose() {
    this.#disposed = true;
    this.#queue.dispose();
  }
}
