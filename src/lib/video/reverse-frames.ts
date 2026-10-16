import { sleep, type FrameQueue } from "./decode";

/** Seconds of media each chunk holds: what one backward stretch decodes in a go. */
const CHUNK_SEC = 0.5;
const TURN_EPS = 0.002;

interface Chunk {
	index: number;
	/** Bitmaps rather than the decoder's frames, which a decoder would stall waiting
	 * to get back. Oldest first. */
	frames: { timestamp: number; image: ImageBitmap }[];
	ready: boolean;
	loaded: Promise<void>;
	dropped: boolean;
}

/** Plays a video backwards. A decoder only runs forward, so the media is decoded a
 * chunk at a time and each chunk handed out last frame first, while the chunk before
 * it decodes. Runs on a decoder of its own, so the forward one stays where it was. */
export class ReverseFrames {
	#open: () => Promise<FrameQueue | null>;
	#queue: Promise<FrameQueue | null> | null = null;
	/** Longest side a kept frame is scaled to; the preview needn't hold full size. */
	#maxSide: number;
	#chunks = new Map<number, Chunk>();
	/** One decoder, so chunks load one after another. */
	#loading: Promise<void> = Promise.resolve();
	#disposed = false;

	constructor(open: () => Promise<FrameQueue | null>, maxSide = Infinity) {
		this.#open = open;
		this.#maxSide = maxSide;
	}

	/** The frame due at `t` on a backward pass, once its chunk has decoded; null when
	 * it's `shown`, the one already up. Also starts on the chunk the pass reaches next. */
	async frameAt(
		t: number,
		shown: number | null = null,
	): Promise<VideoFrame | null> {
		const index = chunkIndex(t);
		this.#keep(index, index - 1);
		const chunk = this.#want(index);
		if (index > 0) this.#want(index - 1);
		// Awaited even by the preview, so a paused scrub gets its frame and a redraw;
		// the sampler turns away other calls meanwhile.
		if (!chunk.ready) await chunk.loaded;
		if (chunk.dropped) return null;
		const due = dueFrame(chunk.frames, t);
		if (!due || due.timestamp === shown) return null;
		return new VideoFrame(due.image, { timestamp: due.timestamp });
	}

	/** Decode the chunk a backward pass starting at `t` shows first, ahead of the turn. */
	prefetch(t: number) {
		// A turn sits on the end itself; the frames shown first are just before it.
		const index = chunkIndex(t - TURN_EPS);
		this.#keep(index, index);
		this.#want(index);
	}

	dispose() {
		this.#disposed = true;
		for (const chunk of this.#chunks.values()) this.#drop(chunk);
		this.#chunks.clear();
		void this.#queue?.then((q) => q?.dispose());
	}

	/** Free every chunk outside [low, high]. */
	#keep(high: number, low: number) {
		for (const [index, chunk] of this.#chunks) {
			if (index < low || index > high) {
				this.#drop(chunk);
				this.#chunks.delete(index);
			}
		}
	}

	#drop(chunk: Chunk) {
		chunk.dropped = true;
		for (const f of chunk.frames) f.image.close();
		chunk.frames = [];
	}

	#want(index: number): Chunk {
		const held = this.#chunks.get(index);
		if (held) return held;
		let settle!: () => void;
		const chunk: Chunk = {
			index,
			frames: [],
			ready: false,
			loaded: new Promise((resolve) => (settle = resolve)),
			dropped: false,
		};
		this.#chunks.set(index, chunk);
		this.#loading = this.#loading.then(async () => {
			try {
				if (!chunk.dropped && !this.#disposed) await this.#load(chunk);
			} catch {
				// A chunk that fails to decode shows nothing new; the last frame holds.
			} finally {
				chunk.ready = true;
				settle();
			}
		});
		return chunk;
	}

	async #load(chunk: Chunk) {
		this.#queue ??= this.#open();
		const queue = await this.#queue;
		if (!queue) return;
		const from = chunk.index * CHUNK_SEC;
		const end = (chunk.index + 1) * CHUNK_SEC * 1e6;
		queue.start(from);
		while (!chunk.dropped && !this.#disposed) {
			const frame = queue.takeHead();
			if (!frame) {
				if (queue.done) break;
				await sleep(4);
				continue;
			}
			if (frame.timestamp >= end) {
				frame.close();
				break;
			}
			const timestamp = frame.timestamp;
			const image = await createImageBitmap(frame, this.#size(frame));
			frame.close();
			if (chunk.dropped) {
				image.close();
				break;
			}
			chunk.frames.push({ timestamp, image });
		}
	}

	#size(frame: VideoFrame): ImageBitmapOptions | undefined {
		const w = frame.displayWidth;
		const h = frame.displayHeight;
		const k = this.#maxSide / Math.max(w, h);
		if (!(k < 1)) return undefined;
		return {
			resizeWidth: Math.max(1, Math.round(w * k)),
			resizeHeight: Math.max(1, Math.round(h * k)),
			resizeQuality: "medium",
		};
	}
}

function chunkIndex(t: number): number {
	return Math.max(0, Math.floor(t / CHUNK_SEC));
}

/** The newest frame shown by `t`; the first one before any is. */
function dueFrame(
	frames: Chunk["frames"],
	t: number,
): Chunk["frames"][number] | null {
	const at = t * 1e6;
	let due = frames[0] ?? null;
	for (const f of frames) {
		if (f.timestamp > at) break;
		due = f;
	}
	return due;
}
