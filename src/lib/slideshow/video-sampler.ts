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

/**
 * Sequential frame sampler for a video slide, shared by preview and export.
 *
 * Unlike VideoPreviewPlayer there is no clock, audio or speed — the caller
 * drives time: `next(dt)` advances the position by `dt` seconds and returns
 * the newest frame due at the new position (or null when the previously
 * returned frame is still current). Position only moves forward, wrapping to
 * 0 at the end, so decode is purely sequential (no seeks). The decode pump
 * starts lazily on the first `next()` call, so samplers for hidden slides
 * hold no decoded frames.
 */
export class SlideVideoSampler {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  /** Accumulated visible time, wrapped into [0, duration). */
  position = 0;

  #queue: SampleQueue;
  /** Whether a frame has been returned since the last (re)start at 0. */
  #delivered = false;
  /** Guards against overlapping next() calls from the preview rAF loop. */
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
   * Advance the position by `dt` seconds and return the newest frame due, or
   * null to keep the previous upload. Waits for decode when no frame has been
   * delivered yet at this position (export needs the exact frame; in preview
   * the decode-ahead queue makes the wait ~never happen).
   * Caller must close() the returned VideoFrame after uploading it.
   */
  async next(dt: number): Promise<VideoFrame | null> {
    if (this.#disposed || this.duration <= 0) return null;
    if (this.#busy) return null;
    this.#busy = true;
    try {
      let t = this.position + dt;
      if (t >= this.duration) {
        t %= this.duration;
        this.#delivered = false;
        this.#queue.start(0);
      }
      this.position = t;
      if (!this.#queue.started) this.#queue.start(t);

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
    } finally {
      this.#busy = false;
    }
  }

  dispose() {
    this.#disposed = true;
    this.#queue.dispose();
  }
}
