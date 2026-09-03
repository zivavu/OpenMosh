/// <reference lib="webworker" />
/**
 * Proxy transcoding, one video at a time, off the main thread.
 *
 * A proxy is a ≤1080p re-encode that previews decode instead of an oversized
 * original: software 4K decode is what drops previews to a few fps on weaker
 * machines, and every per-frame cost — decode, GPU upload, queue memory —
 * scales with pixel count. The original is never modified (exports keep
 * reading it), so the proxy only has to be fast to build and cheap to decode.
 *
 * Statically imported, like decode-worker: a dynamic import would split the
 * worker bundle, which Vite can't emit for a classic worker chunk.
 */
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	Quality,
} from "mediabunny";

export type ProxyWorkerRequest =
	| { type: "convert"; id: number; file: File; width: number; height: number }
	| { type: "cancel"; id: number };

export type ProxyWorkerResponse =
	| { type: "progress"; id: number; progress: number }
	| { type: "done"; id: number; blob: Blob }
	| { type: "failed"; id: number; reason: string };

const conversions = new Map<number, Conversion>();

function post(msg: ProxyWorkerResponse, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

self.onmessage = (e: MessageEvent<ProxyWorkerRequest>) => {
	const msg = e.data;
	if (msg.type === "convert") {
		void convert(msg.id, msg.file, msg.width, msg.height);
		return;
	}
	conversions
		.get(msg.id)
		?.cancel()
		.catch(() => {});
};

async function convert(id: number, file: File, width: number, height: number) {
	try {
		const input = new Input({
			source: new BlobSource(file),
			formats: ALL_FORMATS,
		});
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat(), target });
		const conversion = await Conversion.init({
			input,
			output,
			video: {
				// The caller's dims preserve the aspect ratio, so a sub-pixel rounding
				// difference is all "fill" can stretch by — "contain" would letterbox.
				width,
				height,
				fit: "fill",
				quality: new Quality("medium"),
				// Deliberately no hardwareAcceleration hint: mediabunny picks the
				// codec by probing what the browser can actually encode, but the hint
				// rides into the encoder config afterwards, where a browser without
				// hardware encoding for that codec (Firefox has no H.264 encoder at
				// all) rejects the config and the whole conversion dies. A background
				// proxy is happy to encode in software.
			},
		});
		conversions.set(id, conversion);
		// A discarded video track (no encodable codec, undecodable source) leaves
		// an audio-only or empty conversion — execute() would throw a bare
		// "invalid", so surface the real reason instead.
		if (!conversion.isValid) {
			const reasons = conversion.discardedTracks
				.map((t) => `${t.track.type}: ${t.reason}`)
				.join(", ");
			throw new Error(`no usable tracks — discarded: ${reasons || "none"}`);
		}
		conversion.onProgress = (progress) =>
			post({ type: "progress", id, progress });
		await conversion.execute();
		conversions.delete(id);
		if (!target.buffer) throw new Error("proxy produced no data");
		post({
			type: "done",
			id,
			blob: new Blob([target.buffer], { type: "video/mp4" }),
		});
	} catch (error) {
		// Cancel or a mid-stream decode/encode failure — both read as "no proxy".
		// The error is otherwise invisible: nothing here logs on its own.
		conversions.delete(id);
		console.error(`[proxy] conversion ${id} failed`, error);
		post({ type: "failed", id, reason: String(error) });
	}
}
