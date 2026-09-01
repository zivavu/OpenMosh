/// <reference lib="webworker" />
/**
 * Demux + decode for one or more video streams, off the main thread.
 *
 * Demuxing is what actually runs in JS: mediabunny reads packets, walks the
 * sample tables and hands them to a VideoDecoder, and every step of that is an
 * await that only resumes when the event loop is free. On the main thread it
 * competes with the render loop and Svelte's reactivity, so a preview heavy
 * enough to fill a frame budget starves the decoder feeding it — the decoder
 * idles, the queue empties, and playback stutters with neither CPU nor GPU
 * saturated. Here nothing else is on the thread.
 *
 * Streams share this one worker rather than getting one each: the contention
 * that matters is with the UI, not between two videos, and a worker per sampler
 * would mean a mediabunny module instance per sampler.
 */
// Statically imported, unlike everywhere else: a dynamic import would split the
// worker bundle, which Vite can't emit for a classic worker chunk. Nothing
// loads it until the first video is opened — that is what spawns the worker.
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";

export type DecodeWorkerRequest =
  | {
      type: "open";
      id: number;
      file: File;
      depth: number;
      /** Cap on frame area; 0 hands frames over at their own size. */
      maxPixels: number;
    }
  | { type: "start"; id: number; gen: number; startTime: number }
  | { type: "credit"; id: number; gen: number; n: number }
  | { type: "close"; id: number };

export type DecodeWorkerResponse =
  | {
      type: "opened";
      id: number;
      duration: number;
      width: number;
      height: number;
      /** Size frames actually arrive at, once `maxPixels` has been applied. */
      frameWidth: number;
      frameHeight: number;
    }
  | { type: "unsupported"; id: number }
  | { type: "frame"; id: number; gen: number; frame: VideoFrame }
  | { type: "done"; id: number; gen: number };

interface Stream {
  input: Input;
  sink: VideoSampleSink;
  /** Frames the consumer will hold; the pump may not run further ahead. */
  depth: number;
  /** Bumped by every start/close, retiring the pump that was running. */
  gen: number;
  /** Frames the consumer has room for right now. */
  credit: number;
  /** Resolver for a pump parked on zero credit; null when it isn't parked. */
  wake: (() => void) | null;
  /** Where frames are shrunk to on the way out, or null to pass them through. */
  shrink: Shrink | null;
}

interface Shrink {
  width: number;
  height: number;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

/**
 * A preview draws the source at a few hundred pixels; handing it a 4K frame
 * means uploading and sampling ~19x the pixels it can show, on top of moving
 * every one of them across a thread boundary. Shrinking here instead keeps all
 * of that off the main thread and lets the decoder's own frame go back into its
 * pool immediately, which is what a 4K decoder is shortest of.
 *
 * Preview only — `maxPixels` is 0 on the export paths, which need the frame the
 * file actually holds.
 */
function planShrink(w: number, h: number, maxPixels: number): Shrink | null {
  if (maxPixels <= 0 || w * h <= maxPixels) return null;
  const k = Math.sqrt(maxPixels / (w * h));
  // Even dimensions: odd ones are a needless edge case for anything that later
  // wants the frame in a chroma-subsampled format.
  const width = Math.max(2, Math.round((w * k) / 2) * 2);
  const height = Math.max(2, Math.round((h * k) / 2) * 2);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  return { width, height, canvas, ctx };
}

const streams = new Map<number, Stream>();
/** Ids closed while their open was still in flight. */
const abandoned = new Set<number>();

function post(msg: DecodeWorkerResponse, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function wake(stream: Stream) {
  const resume = stream.wake;
  if (!resume) return;
  stream.wake = null;
  resume();
}

self.onmessage = (e: MessageEvent<DecodeWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "open") {
    void open(msg.id, msg.file, msg.depth, msg.maxPixels);
    return;
  }
  const stream = streams.get(msg.id);
  if (!stream) {
    if (msg.type === "close") abandoned.add(msg.id);
    return;
  }
  switch (msg.type) {
    case "start":
      stream.gen = msg.gen;
      stream.credit = stream.depth;
      wake(stream);
      void pump(msg.id, stream, msg.gen, msg.startTime);
      break;
    case "credit":
      // A credit from before the last restart is for frames that were dropped;
      // the restart already reset the allowance.
      if (stream.gen !== msg.gen) break;
      stream.credit += msg.n;
      wake(stream);
      break;
    case "close":
      streams.delete(msg.id);
      stream.gen++;
      wake(stream);
      stream.input.dispose();
      break;
  }
};

async function open(
  id: number,
  file: File,
  depth: number,
  maxPixels: number,
) {
  try {
    const input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
    // Same eligibility rules as the main-thread path: rotation metadata is
    // applied by the <video> element but not to raw decoded frames.
    const track = await input.getPrimaryVideoTrack();
    const duration = track ? await track.computeDuration() : 0;
    if (
      !track ||
      track.rotation !== 0 ||
      !(await track.canDecode()) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      track.displayWidth <= 0 ||
      track.displayHeight <= 0 ||
      abandoned.delete(id)
    ) {
      input.dispose();
      post({ type: "unsupported", id });
      return;
    }
    const shrink = planShrink(
      track.displayWidth,
      track.displayHeight,
      maxPixels,
    );
    streams.set(id, {
      input,
      sink: new VideoSampleSink(track),
      depth,
      gen: 0,
      credit: 0,
      wake: null,
      shrink,
    });
    post({
      type: "opened",
      id,
      duration,
      width: track.displayWidth,
      height: track.displayHeight,
      frameWidth: shrink?.width ?? track.displayWidth,
      frameHeight: shrink?.height ?? track.displayHeight,
    });
  } catch {
    post({ type: "unsupported", id });
  }
}

/**
 * Decode from `startTime` into the consumer's queue, parking whenever it has
 * no room left. Frames are transferred, not copied — the consumer owns each
 * one once it lands and is what frees the slot it took.
 */
async function pump(
  id: number,
  stream: Stream,
  gen: number,
  startTime: number,
) {
  try {
    for await (const sample of stream.sink.samples(startTime)) {
      while (stream.gen === gen && stream.credit <= 0) {
        await new Promise<void>((resolve) => (stream.wake = resolve));
      }
      if (stream.gen !== gen) {
        sample.close();
        return;
      }
      const frame = shrunk(sample.toVideoFrame(), stream.shrink);
      sample.close();
      stream.credit--;
      post({ type: "frame", id, gen, frame }, [frame]);
    }
    if (stream.gen === gen) post({ type: "done", id, gen });
  } catch {
    // Decode failure mid-stream, or the input disposed under us: the consumer
    // keeps the last frame it got.
    if (stream.gen === gen) post({ type: "done", id, gen });
  }
}

/** `frame` at the stream's preview size, or `frame` itself when it isn't capped. */
function shrunk(frame: VideoFrame, shrink: Shrink | null): VideoFrame {
  if (!shrink) return frame;
  try {
    shrink.ctx.drawImage(frame, 0, 0, shrink.width, shrink.height);
    const scaled = new VideoFrame(shrink.canvas, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
    });
    frame.close();
    return scaled;
  } catch {
    // Nothing here is worth dropping a frame over: hand over the full one.
    return frame;
  }
}
