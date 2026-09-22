import {
	openPlayableVideo,
	sleep,
	toVideoFrame,
	type FrameQueue,
} from "../video/decode";
import { openVideoFrameSource } from "../video/frame-source";

export interface SlideVideoProbe {
	duration: number;
	width: number;
	height: number;
	thumb: Blob | null;
}

/** Eligibility check for a video slide, mirroring the single-editor WebCodecs rules
 * (no rotation metadata, decodable codec); also grabs duration and a thumbnail. */
export async function probeSlideVideo(
	file: File,
	thumbSize = 100,
): Promise<SlideVideoProbe | null> {
	const opened = await openPlayableVideo(file);
	if (!opened) return null;

	let thumb: Blob | null = null;
	try {
		// Iterated rather than getSample(0): that returns null whenever the track's first
		// frame sits past zero (edit list or phone/camera muxer).
		for await (const sample of opened.sink.samples()) {
			const frame = toVideoFrame(sample);
			thumb = await drawThumb(frame, thumbSize);
			frame.close();
			break;
		}
	} catch {
	} finally {
		// Nothing here outlives the probe: callers get plain data back.
		opened.input.dispose();
	}
	return {
		duration: opened.duration,
		width: opened.width,
		height: opened.height,
		thumb,
	};
}

async function drawThumb(
	frame: VideoFrame,
	size: number,
): Promise<Blob | null> {
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

/** Forward jump past this many seconds is seeked, not decoded through. */
const SEEK_AHEAD = 0.75;
/** If decode falls this far (media seconds) behind a preview, keyframe-jump. */
const MAX_DECODE_LAG = 0.5;
/** Backward slack, so float noise in a clock doesn't trigger a seek. */
const BACK_EPS = 0.001;

/** Frame sampler for a video slide, shared by preview and export. No clock, audio
 * or speed: the caller states the position with `at(t)`. */
export class SlideVideoSampler {
	readonly duration: number;
	readonly width: number;
	readonly height: number;
	position = 0;

	#queue: FrameQueue;
	/** Whether a frame has been returned since the last (re)start at 0. */
	#delivered = false;
	/** Guards against overlapping at() calls from the preview rAF loop. */
	#busy = false;
	#disposed = false;

	private constructor(
		queue: FrameQueue,
		duration: number,
		width: number,
		height: number,
	) {
		this.#queue = queue;
		this.duration = duration;
		this.width = width;
		this.height = height;
	}

	static async create(file: File): Promise<SlideVideoSampler | null> {
		const opened = await openVideoFrameSource(file);
		if (!opened) return null;
		return new SlideVideoSampler(
			opened.queue,
			opened.duration,
			opened.width,
			opened.height,
		);
	}

	reset() {
		this.position = 0;
		this.#delivered = false;
		if (this.#queue.started) this.#queue.start(0);
	}

	/** Move to absolute position `t` (wrapped into the clip) and return the frame due
	 * there, or null to keep the previous upload. `wait` separates the two callers. */
	async at(t: number, wait = true): Promise<VideoFrame | null> {
		if (this.#disposed || this.duration <= 0) return null;
		if (this.#busy) return null;
		this.#busy = true;
		try {
			const want = ((t % this.duration) + this.duration) % this.duration;
			const delta = want - this.position;
			this.position = want;
			// Creeping forward is what the queue is for; anything else is a jump, and
			// re-pumping beats decoding through the gap.
			if (!this.#queue.started || delta < -BACK_EPS || delta > SEEK_AHEAD) {
				this.#delivered = false;
				this.#queue.start(want);
			} else if (
				!wait &&
				this.#delivered &&
				!this.#queue.done &&
				this.#queue.size === 0 &&
				want - this.#queue.head > MAX_DECODE_LAG
			) {
				// Decode has fallen behind the clock with nothing queued to catch up from, so
				// every frame it decodes is one the playhead already passed. Previews only.
				this.#queue.start(want);
			}
			return await this.#take(want, wait);
		} finally {
			this.#busy = false;
		}
	}

	/** The newest queued frame due at `t`. Waits for decode if none has landed and
	 * `wait` allows it; a caller with a frame on screen keeps it. */
	async #take(t: number, wait: boolean): Promise<VideoFrame | null> {
		while (!this.#disposed) {
			const due = this.#queue.takeDue(t);
			if (due) {
				this.#delivered = true;
				return due;
			}
			if (this.#queue.size > 0) {
				// Head is in the future. If a frame was already shown it's still current;
				// otherwise show the head so the slide isn't blank.
				if (this.#delivered) return null;
				this.#delivered = true;
				return this.#queue.takeHead()!;
			}
			if (this.#queue.done) return null;
			if (!wait && this.#delivered) return null;
			await sleep(5);
		}
		return null;
	}

	dispose() {
		this.#disposed = true;
		this.#queue.dispose();
	}
}
