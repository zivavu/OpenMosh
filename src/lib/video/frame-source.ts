import type {
  DecodeWorkerRequest,
  DecodeWorkerResponse,
} from "./decode-worker";
import {
  decodeStats,
  openPlayableVideo,
  QUEUE_DEPTH,
  SampleQueue,
  type FrameQueue,
} from "./decode";

export interface VideoFrameSource {
  queue: FrameQueue;
  duration: number;
  /** The media's own size — what an export writes and the UI reports. */
  width: number;
  height: number;
  /** Size the frames actually arrive at, which the source texture is sized to. */
  frameWidth: number;
  frameHeight: number;
}

/**
 * Open a file as a queue of decoded frames, decoding in a worker where that is
 * available and on the main thread otherwise. Null when the file can't drive
 * the WebCodecs path at all, which is the caller's cue to fall back to a
 * <video> element.
 *
 * Frames arrive at the size the file holds on both paths — see the decode
 * worker for why they are no longer downscaled on the way out.
 */
export async function openVideoFrameSource(
  file: File,
): Promise<VideoFrameSource | null> {
  const worker = getWorker();
  if (worker) {
    const viaWorker = await openInWorker(worker, file);
    // "unsupported" is the file's verdict, not the worker's, and the
    // main-thread path applies the same rules — so don't pay to re-check.
    if (viaWorker !== "no-worker") return viaWorker;
  }
  const opened = await openPlayableVideo(file);
  if (!opened) return null;
  return {
    queue: new SampleQueue(opened.sink),
    duration: opened.duration,
    width: opened.width,
    height: opened.height,
    frameWidth: opened.width,
    frameHeight: opened.height,
  };
}

// ── Shared worker plumbing ─────────────────────────────────────────────────

let worker: Worker | null = null;
let workerUnavailable = false;
let nextStreamId = 1;

const queues = new Map<number, WorkerFrameQueue>();
const opens = new Map<number, (result: OpenResult) => void>();

type OpenResult = Omit<VideoFrameSource, "queue"> | null;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable) return null;
  if (typeof Worker === "undefined" || typeof VideoDecoder === "undefined") {
    workerUnavailable = true;
    return null;
  }
  try {
    const spawned = new Worker(new URL("./decode-worker.ts", import.meta.url), {
      type: "module",
    });
    spawned.onmessage = (e: MessageEvent<DecodeWorkerResponse>) =>
      route(e.data);
    spawned.onerror = () => {
      // A worker that failed to load can't answer anything already asked of
      // it, and won't answer anything asked later either.
      workerUnavailable = true;
      worker = null;
      for (const resolve of opens.values()) resolve(null);
      opens.clear();
    };
    worker = spawned;
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

async function openInWorker(
  target: Worker,
  file: File,
): Promise<VideoFrameSource | null | "no-worker"> {
  const id = nextStreamId++;
  const opened = await new Promise<OpenResult>((resolve) => {
    opens.set(id, resolve);
    target.postMessage({
      type: "open",
      id,
      file,
      depth: QUEUE_DEPTH,
    } satisfies DecodeWorkerRequest);
  });
  // The worker dying mid-open is the one case where the file may still be fine.
  if (!opened) return workerUnavailable ? "no-worker" : null;
  const queue = new WorkerFrameQueue(target, id);
  queues.set(id, queue);
  return { queue, ...opened };
}

function route(msg: DecodeWorkerResponse) {
  switch (msg.type) {
    case "opened": {
      const { duration, width, height } = msg;
      opens.get(msg.id)?.({
        duration,
        width,
        height,
        frameWidth: width,
        frameHeight: height,
      });
      opens.delete(msg.id);
      break;
    }
    case "unsupported":
      opens.get(msg.id)?.(null);
      opens.delete(msg.id);
      break;
    case "frame": {
      const queue = queues.get(msg.id);
      if (queue) queue.accept(msg.gen, msg.frame);
      else msg.frame.close();
      break;
    }
    case "done":
      queues.get(msg.id)?.finish(msg.gen);
      break;
  }
}

/**
 * The consumer half of a worker-decoded stream: frames land here by message
 * and are drained synchronously by the render loop, exactly as with the
 * main-thread pump.
 *
 * Backpressure crosses the thread boundary as credit. The worker may only run
 * `depth` frames ahead of what the consumer holds, and every frame taken out
 * of this queue hands one slot back — so a paused preview parks the decoder
 * instead of decoding the rest of the file into memory.
 */
class WorkerFrameQueue implements FrameQueue {
  #worker: Worker;
  #id: number;
  #frames: VideoFrame[] = [];
  /** Bumped by every start, retiring frames still in flight from the worker. */
  #gen = 0;
  #started = false;
  #done = false;
  #head = 0;
  #received = 0;
  #disposed = false;

  constructor(target: Worker, id: number) {
    this.#worker = target;
    this.#id = id;
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
    if (this.#disposed) return;
    // No credit for these: the worker resets the whole allowance on start.
    for (const frame of this.#frames) frame.close();
    this.#frames = [];
    this.#gen++;
    this.#started = true;
    this.#done = false;
    this.#head = startTime;
    this.#post({ type: "start", id: this.#id, gen: this.#gen, startTime });
  }

  takeDue(t: number): VideoFrame | null {
    let chosen: VideoFrame | null = null;
    let taken = 0;
    while (this.#frames.length > 0 && this.#frames[0].timestamp <= t * 1e6) {
      chosen?.close();
      chosen = this.#frames.shift()!;
      taken++;
    }
    if (taken > 0) this.#credit(taken);
    return chosen;
  }

  takeHead(): VideoFrame | null {
    const frame = this.#frames.shift() ?? null;
    if (frame) this.#credit(1);
    return frame;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const frame of this.#frames) frame.close();
    this.#frames = [];
    queues.delete(this.#id);
    this.#post({ type: "close", id: this.#id });
  }

  /** A frame off the wire, or a stale one from before the last restart. */
  accept(gen: number, frame: VideoFrame) {
    if (this.#disposed || gen !== this.#gen) {
      frame.close();
      return;
    }
    this.#frames.push(frame);
    this.#head = frame.timestamp / 1e6;
    this.#received++;
    decodeStats.frames++;
  }

  finish(gen: number) {
    if (gen === this.#gen) this.#done = true;
  }

  #credit(n: number) {
    this.#post({ type: "credit", id: this.#id, gen: this.#gen, n });
  }

  #post(msg: DecodeWorkerRequest) {
    if (workerUnavailable) return;
    this.#worker.postMessage(msg);
  }
}
