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
 * The resize is done by a registered VideoSampleTransformer rather than
 * mediabunny's built-in one: its path draws decoded frames with 2D-canvas
 * drawImage, which Firefox rejects for some hardware-decoded streams (HDR
 * ones, observedly) with "Passed-in video frame is broken" even though the
 * pixels are perfectly readable through other paths. The transformer draws
 * through the same fast path first and falls back to ImageBitmap and then to
 * raw pixel copies — one of those always works if the preview can show the
 * video at all.
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
	registerVideoSampleTransformer,
	VideoSample,
	type VideoSampleTransformationDescription,
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

/** Index of the draw path that last worked; starts on mediabunny's own. */
let drawTier = 0;
/** Logged once per tier, so a machine where every path fails stays readable. */
const loggedTier = new Set<number>();

/**
 * Draw `sample` onto `canvas` at the description's size. Tiers are ordered by
 * speed; each is only tried after the one before it failed, and the first
 * success sticks for the rest of the conversion.
 */
async function drawResized(
	sample: VideoSample,
	canvas: OffscreenCanvas,
	description: VideoSampleTransformationDescription,
): Promise<void> {
	const ctx = canvas.getContext("2d", { alpha: true });
	if (!ctx) throw new Error("proxy resize canvas has no 2d context");
	for (let tier = drawTier; tier < 3; tier++) {
		try {
			if (tier === 0) {
				// mediabunny's own draw — handles rotation, crop and fit itself.
				sample.drawWithFit(ctx, {
					fit: description.fit,
					rotation: description.rotation,
					crop: description.crop,
				});
			} else {
				// Fallbacks assume the simple case proxies always run in: upright
				// frame, fill fit, no crop. Anything else returned null upstream.
				if (description.alpha === "discard") {
					ctx.fillStyle = "black";
					ctx.fillRect(0, 0, canvas.width, canvas.height);
				}
				if (tier === 1) {
					await drawViaBitmap(sample, ctx, description);
				} else {
					await drawViaPixels(sample, ctx, description);
				}
			}
			drawTier = tier;
			return;
		} catch (error) {
			if (tier === 2) throw error;
			if (!loggedTier.has(tier)) {
				loggedTier.add(tier);
				console.warn(`[proxy] draw tier ${tier} failed, falling back`, error);
			}
		}
	}
}

/** Route around the 2D canvas' VideoFrame handling via an ImageBitmap. */
async function drawViaBitmap(
	sample: VideoSample,
	ctx: OffscreenCanvasRenderingContext2D,
	description: VideoSampleTransformationDescription,
): Promise<void> {
	const frame = sample.toVideoFrame();
	try {
		const bitmap = await createImageBitmap(frame, {
			resizeWidth: description.width,
			resizeHeight: description.height,
			resizeQuality: "high",
		});
		try {
			ctx.drawImage(bitmap, 0, 0, description.width, description.height);
		} finally {
			bitmap.close();
		}
	} finally {
		frame.close();
	}
}

/** Last resort: read the raw pixels and assemble them ourselves. */
async function drawViaPixels(
	sample: VideoSample,
	ctx: OffscreenCanvasRenderingContext2D,
	description: VideoSampleTransformationDescription,
): Promise<void> {
	const frame = sample.toVideoFrame();
	try {
		const buffer = new Uint8Array(frame.allocationSize({ format: "RGBA" }));
		await frame.copyTo(buffer, { format: "RGBA" });
		const temp = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
		const tempCtx = temp.getContext("2d", { alpha: false });
		if (!tempCtx) throw new Error("proxy pixel canvas has no 2d context");
		tempCtx.putImageData(
			new ImageData(
				new Uint8ClampedArray(buffer.buffer),
				temp.width,
				temp.height,
			),
			0,
			0,
		);
		ctx.drawImage(temp, 0, 0, description.width, description.height);
	} finally {
		frame.close();
	}
}

/**
 * The transformer mediabunny will call instead of its own canvas path. Only
 * the simple case is handled — upright frame, fill fit, no crop — which is
 * the only one the proxy ever asks for; anything else defers back.
 *
 * The canvas is created with alpha like mediabunny's own transformation
 * canvases: Firefox glitches when making VideoFrames from opaque ones.
 */
registerVideoSampleTransformer((sample, description) => {
	if (
		description.rotation !== 0 ||
		description.fit !== "fill" ||
		description.crop.left !== 0 ||
		description.crop.top !== 0 ||
		description.crop.width < sample.displayWidth ||
		description.crop.height < sample.displayHeight
	) {
		return null;
	}
	const canvas = resizeCanvas(description.width, description.height);
	const result = drawResized(sample, canvas, description);
	// drawResized is async only because its fallbacks are; the first tier is
	// synchronous, and a transformer may return a promise.
	return result.then(
		() =>
			new VideoSample(canvas, {
				timestamp: sample.timestamp,
				duration: sample.duration,
				rotation: 0,
			}),
	);
});

/**
 * One canvas per size, reused across frames — the VideoSample made from it
 * snapshots the pixels at construction, so the next frame can reuse it.
 */
const resizeCanvases = new Map<string, OffscreenCanvas>();

function resizeCanvas(width: number, height: number): OffscreenCanvas {
	const key = `${width}x${height}`;
	let canvas = resizeCanvases.get(key);
	if (!canvas) {
		canvas = new OffscreenCanvas(width, height);
		resizeCanvases.set(key, canvas);
	}
	return canvas;
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
