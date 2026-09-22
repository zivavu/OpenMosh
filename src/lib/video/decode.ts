import type {
	Input,
	InputAudioTrack,
	InputVideoTrack,
	VideoSample,
	VideoSampleSink,
} from "mediabunny";

export const sleep = (ms: number) =>
	new Promise<void>((r) => setTimeout(r, ms));

/** Decode-ahead queue depth; absorbs consumer/decoder cadence mismatch. */
export const QUEUE_DEPTH = 8;

/** Frames every queue has produced, for the preview's FPS overlay. */
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

/** Open a file's primary video track for WebCodecs decoding, or null when it
 * can't drive that path; rotated files fall back to the <video> element. */
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

/** As openDecodableVideo, plus the dimensions and duration a player needs. */
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

/** Open a file's primary audio track. The caller owns the input and disposes it. */
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

/** Convert a sample to a VideoFrame and close the sample. */
export function toVideoFrame(sample: VideoSample): VideoFrame {
	const frame = sample.toVideoFrame();
	sample.close();
	return frame;
}

/** A bounded queue of decoded frames fed by a decode pump, drained synchronously
 * by a render loop. Timestamps are seconds; handed-out frames are the caller's. */
export interface FrameQueue {
	/** True once the source is exhausted. */
	readonly done: boolean;
	readonly started: boolean;
	readonly size: number;
	/** Timestamp of the newest decoded frame, i.e. how far ahead the decoder is. */
	readonly head: number;
	/** Frames landed since creation, for a decode rate. */
	readonly received: number;
	/** (Re)start decoding from `startTime`, dropping anything queued. */
	start(startTime: number): void;
	/** Newest frame due at `t`; older due frames are dropped so a lagging consumer
	 * catches up. */
	takeDue(t: number): VideoFrame | null;
	/** Queue head regardless of timestamp; null when empty. */
	takeHead(): VideoFrame | null;
	dispose(): void;
}

/** Main-thread decode pump feeding a bounded ready-queue, the fallback where the
 * worker path can't be used; it parks while full, woken by the next take. */
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
		// Also wakes a parked pump so it notices its generation was retired.
		this.#wake();
	}

	/** Let a parked pump re-check for room. */
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
					// Parked until a consumer frees a slot; a paused preview waits here indefinitely.
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
