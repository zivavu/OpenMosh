import type { VideoSample, VideoSampleSink } from "mediabunny";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Decode-ahead queue depth; absorbs rAF/decoder cadence mismatch. */
const QUEUE_DEPTH = 8;

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
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) return null;
    if (track.displayWidth <= 0 || track.displayHeight <= 0) return null;

    let thumb: Blob | null = null;
    try {
      const sink = new mb.VideoSampleSink(track);
      const sample = await sink.getSample(0);
      if (sample) {
        const frame = sample.toVideoFrame();
        sample.close();
        thumb = await drawThumb(frame, thumbSize);
        frame.close();
      }
    } catch {
      // Thumbless slide is fine — grid shows the loading placeholder
    }
    return {
      duration,
      width: track.displayWidth,
      height: track.displayHeight,
      thumb,
    };
  } catch {
    return null;
  }
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

  #sink: VideoSampleSink;
  #queue: VideoSample[] = [];
  /** Bumping cancels the previous pump loop. */
  #genId = 0;
  #pumpStarted = false;
  #pumpDone = false;
  /** Whether a frame has been returned since the last (re)start at 0. */
  #delivered = false;
  /** Guards against overlapping next() calls from the preview rAF loop. */
  #busy = false;
  #disposed = false;

  private constructor(
    sink: VideoSampleSink,
    duration: number,
    width: number,
    height: number,
  ) {
    this.#sink = sink;
    this.duration = duration;
    this.width = width;
    this.height = height;
  }

  /** Returns null when the file can't drive the WebCodecs path. */
  static async create(file: File): Promise<SlideVideoSampler | null> {
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
      const duration = await track.computeDuration();
      if (!Number.isFinite(duration) || duration <= 0) return null;
      if (track.displayWidth <= 0 || track.displayHeight <= 0) return null;
      return new SlideVideoSampler(
        new mb.VideoSampleSink(track),
        duration,
        track.displayWidth,
        track.displayHeight,
      );
    } catch {
      return null;
    }
  }

  /** Rewind to 0 so a fresh preview/export run starts deterministically. */
  reset() {
    this.position = 0;
    this.#delivered = false;
    if (this.#pumpStarted) this.#restartPump(0);
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
        this.#restartPump(0);
      }
      this.position = t;
      if (!this.#pumpStarted) this.#startPump(t);

      while (!this.#disposed) {
        // Newest due sample wins; older due samples are stale — discard.
        let chosen: VideoSample | null = null;
        while (this.#queue.length > 0 && this.#queue[0].timestamp <= t) {
          chosen?.close();
          chosen = this.#queue.shift()!;
        }
        if (chosen) {
          this.#delivered = true;
          const frame = chosen.toVideoFrame();
          chosen.close();
          return frame;
        }
        if (this.#queue.length > 0) {
          // Head is in the future. If we've already shown a frame it's still
          // current; otherwise (first frame timestamp > t) show the head so
          // the slide isn't blank on its first beat.
          if (this.#delivered) return null;
          const sample = this.#queue.shift()!;
          this.#delivered = true;
          const frame = sample.toVideoFrame();
          sample.close();
          return frame;
        }
        if (this.#pumpDone) return null;
        await sleep(5);
      }
      return null;
    } finally {
      this.#busy = false;
    }
  }

  dispose() {
    this.#disposed = true;
    this.#genId++;
    this.#clearQueue();
  }

  #startPump(t: number) {
    this.#pumpStarted = true;
    void this.#pump(t);
  }

  #restartPump(t: number) {
    this.#clearQueue();
    this.#pumpStarted = true;
    void this.#pump(t);
  }

  #clearQueue() {
    for (const sample of this.#queue) sample.close();
    this.#queue = [];
  }

  /**
   * Sequential decode loop: fills the ready-queue as fast as the decoder
   * allows, parking while the queue is full.
   */
  async #pump(startTime: number) {
    const id = ++this.#genId;
    this.#pumpDone = false;
    try {
      for await (const sample of this.#sink.samples(startTime)) {
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
      }
      if (id === this.#genId) this.#pumpDone = true;
    } catch {
      // Decode failure mid-stream: keep the last good frame on screen
      if (id === this.#genId) this.#pumpDone = true;
    }
  }
}
