/// <reference lib="webworker" />
/** Proxy transcoding, one video at a time, off the main thread: a <=1080p re-encode. */
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	canEncodeVideo,
	Conversion,
	Input,
	type InputVideoTrack,
	Mp4OutputFormat,
	Output,
	Quality,
	registerVideoSampleTransformer,
	VideoSample,
	type VideoCodec,
	VideoSampleSink,
	type VideoSampleTransformationDescription,
} from "mediabunny";

export type ProxyWorkerRequest =
	{ type: "convert"; id: number; file: File } | { type: "cancel"; id: number };

export type ProxyWorkerResponse =
	/** The size the proxy will be, decided before the first frame is encoded. */
	| { type: "sized"; id: number; width: number; height: number }
	| { type: "progress"; id: number; progress: number }
	| { type: "done"; id: number; blob: Blob }
	| { type: "failed"; id: number; reason: string };

const conversions = new Map<number, Conversion>();

function post(msg: ProxyWorkerResponse, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

/** Long-edge ceiling on machines that decode comfortably. */
const FHD_LONG_EDGE = 1920;
/** Long-edge ceiling on machines that can't decode the source at 2× realtime. */
const HD_LONG_EDGE = 1280;
/** Source media the benchmark decodes before judging speed. */
const BENCH_MEDIA_SECONDS = 2;
/** Wall-clock cap on the benchmark; past this the verdict is clear. */
const BENCH_WALL_MS = 1500;

/** Decode the first moments of a track and time it, as a multiple of realtime;
 * null when it can't be decoded. */
async function benchmarkDecode(track: InputVideoTrack): Promise<number | null> {
	try {
		const sink = new VideoSampleSink(track);
		const start = performance.now();
		let media = 0;
		for await (const sample of sink.samples(0, BENCH_MEDIA_SECONDS)) {
			media = sample.timestamp + sample.duration;
			sample.close();
			if (performance.now() - start > BENCH_WALL_MS) break;
		}
		const wall = (performance.now() - start) / 1000;
		if (media <= 0) return null;
		return media / Math.max(wall, 0.001);
	} catch (error) {
		console.warn("[proxy] decode benchmark failed", error);
		return null;
	}
}

/** Under 2× realtime gets an HD proxy; an unmeasurable source is assumed strong. */
function pickLongEdge(realtime: number | null): number {
	if (realtime === null) return FHD_LONG_EDGE;
	const weak = realtime < 2;
	console.info(
		`[proxy] source decodes at ${realtime.toFixed(1)}× realtime — ${weak ? "HD" : "Full HD"} proxy`,
	);
	return weak ? HD_LONG_EDGE : FHD_LONG_EDGE;
}

/** `preferBitrate` makes this a quality setting rather than a quantizer: QP rate
 * control puts no ceiling on the result. */
const PROXY_QUALITY = new Quality({ quality: "medium", preferBitrate: true });

/** Seconds between key frames, against mediabunny's default of 2. Previews seek
 * constantly, and each seek decodes from the preceding key frame. */
const KEY_FRAME_INTERVAL = 1;

/** Codecs a proxy may use, ordered by how likely a decoder is to be cheap. */
const PROXY_CODECS: VideoCodec[] = ["avc", "hevc", "vp9", "av1", "vp8"];

/** Representative codec strings for probing for a hardware decoder. */
const DECODE_PROBES: Record<VideoCodec, string | null> = {
	avc: "avc1.640028", // High 4.0
	hevc: "hvc1.1.6.L120.90", // Main 4.0
	vp9: "vp09.00.10.08", // Profile 0, 8-bit
	av1: "av01.0.05M.08", // Main, level 3.1, 8-bit
	vp8: "vp8",
	prores: null, // Not a browser codec; never a proxy target.
};

/** The first codec this machine can both encode and decode in hardware; null
 * defers to mediabunny. */
async function pickCodec(
	width: number,
	height: number,
): Promise<VideoCodec | null> {
	for (const codec of PROXY_CODECS) {
		if (!(await canHardwareDecode(codec, width, height))) continue;
		if (
			!(await canEncodeVideo(codec, { width, height, quality: PROXY_QUALITY }))
		) {
			continue;
		}
		console.info(`[proxy] encoding in ${codec} (hardware-decodable here)`);
		return codec;
	}
	// Nothing decodes in hardware, so the win has to come from pixel count alone.
	console.info("[proxy] no hardware-decodable codec, deferring the choice");
	return null;
}

async function canHardwareDecode(
	codec: VideoCodec,
	width: number,
	height: number,
): Promise<boolean> {
	const probe = DECODE_PROBES[codec];
	if (!probe || typeof VideoDecoder === "undefined") return false;
	try {
		const support = await VideoDecoder.isConfigSupported({
			codec: probe,
			codedWidth: width,
			codedHeight: height,
			hardwareAcceleration: "prefer-hardware",
		});
		return support.supported === true;
	} catch {
		// A config the browser won't even consider reads as "no".
		return false;
	}
}

/** Even-dimensioned size capping the long edge; H.264 rejects odd sizes. */
function shrinkToLongEdge(width: number, height: number, longEdge: number) {
	const scale = Math.min(1, longEdge / Math.max(width, height));
	return {
		width: Math.max(2, Math.round((width * scale) / 2) * 2),
		height: Math.max(2, Math.round((height * scale) / 2) * 2),
	};
}

/** Index of the draw path that last worked; reset per conversion. */
let drawTier = 0;
/** Logged once per tier, so a machine where every path fails stays readable. */
const loggedTier = new Set<number>();

/** Draw `sample` onto `canvas`; tiers are ordered by speed, first success sticks. */
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
				// mediabunny's own draw, which handles rotation, crop and fit itself.
				sample.drawWithFit(ctx, {
					fit: description.fit,
					rotation: description.rotation,
					crop: description.crop,
				});
			} else {
				// Fallbacks assume the simple case proxies run in: upright, fill fit, no crop.
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

/** Last resort: read the raw pixels and assemble them ourselves. RGBA first, then
 * the frame's own format, which Firefox accepts where RGBA fails. */
async function drawViaPixels(
	sample: VideoSample,
	ctx: OffscreenCanvasRenderingContext2D,
	description: VideoSampleTransformationDescription,
): Promise<void> {
	const frame = sample.toVideoFrame();
	try {
		let source: OffscreenCanvas | VideoFrame;
		try {
			source = await copyToCanvas(frame);
		} catch (error) {
			if (!frame.format) throw error;
			source = await copyToFrame(frame, frame.format);
		}
		try {
			ctx.drawImage(source, 0, 0, description.width, description.height);
		} finally {
			if (source instanceof VideoFrame) source.close();
		}
	} finally {
		frame.close();
	}
}

/** The frame's pixels converted to RGBA and put on a canvas. */
async function copyToCanvas(frame: VideoFrame): Promise<OffscreenCanvas> {
	// Sized off the visible rect; an anamorphic display size makes ImageData reject it.
	const rect = frame.visibleRect;
	const canvas = new OffscreenCanvas(
		rect?.width ?? frame.codedWidth,
		rect?.height ?? frame.codedHeight,
	);
	const ctx = canvas.getContext("2d", { alpha: false });
	if (!ctx) throw new Error("proxy pixel canvas has no 2d context");
	const buffer = new Uint8Array(frame.allocationSize({ format: "RGBA" }));
	await frame.copyTo(buffer, { format: "RGBA" });
	ctx.putImageData(
		new ImageData(
			new Uint8ClampedArray(buffer.buffer),
			canvas.width,
			canvas.height,
		),
		0,
		0,
	);
	return canvas;
}

/** The frame's pixels in its own format, rewrapped so a canvas can take them. */
async function copyToFrame(
	frame: VideoFrame,
	format: VideoPixelFormat,
): Promise<VideoFrame> {
	const rect = frame.visibleRect;
	const buffer = new Uint8Array(frame.allocationSize());
	const layout = await frame.copyTo(buffer);
	return new VideoFrame(buffer, {
		format,
		codedWidth: rect?.width ?? frame.codedWidth,
		codedHeight: rect?.height ?? frame.codedHeight,
		layout,
		timestamp: frame.timestamp,
	});
}

/** Tail of the transform queue; see the transformer below. */
let transforms: Promise<void> = Promise.resolve();

/** The transformer mediabunny calls instead of its own canvas path; only the
 * simple case (upright, fill fit, no crop) is handled. */
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
	// One frame at a time: the canvas is shared and the fallback tiers await.
	const result = transforms.then(async () => {
		await drawResized(sample, canvas, description);
		return new VideoSample(canvas, {
			timestamp: sample.timestamp,
			duration: sample.duration,
			rotation: 0,
		});
	});
	transforms = result.then(
		() => {},
		() => {},
	);
	return result;
});

/** One canvas per size, reused: the VideoSample made from it snapshots the pixels. */
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
		void convert(msg.id, msg.file);
		return;
	}
	conversions
		.get(msg.id)
		?.cancel()
		.catch(() => {});
};

/** Log what the proxy came out as, next to the source: without a measured number a
 * proxy that decodes slower than its source looks like one that works. */
async function reportProxy(blob: Blob, sourceRealtime: number | null) {
	try {
		const input = new Input({
			source: new BlobSource(blob),
			formats: ALL_FORMATS,
		});
		try {
			const track = await input.getPrimaryVideoTrack();
			if (!track) return;
			const duration = await track.computeDuration();
			const mbps = duration > 0 ? (blob.size * 8) / duration / 1e6 : 0;
			const realtime = await benchmarkDecode(track);
			const versus =
				realtime !== null && sourceRealtime !== null
					? ` (source: ${sourceRealtime.toFixed(1)}×)`
					: "";
			console.info(
				`[proxy] ${await track.getCodecParameterString()} ${track.displayWidth}×${track.displayHeight}` +
					` @ ${mbps.toFixed(1)} Mbps, decodes at ${realtime?.toFixed(1) ?? "?"}× realtime${versus}`,
			);
			if (
				realtime !== null &&
				sourceRealtime !== null &&
				realtime < sourceRealtime
			) {
				console.warn(
					"[proxy] the proxy decodes slower than the source it replaces",
				);
			}
		} finally {
			input.dispose();
		}
	} catch (error) {
		// Diagnostics only; a proxy that resists measurement still plays.
		console.warn("[proxy] could not measure the finished proxy", error);
	}
}

async function convert(id: number, file: File) {
	try {
		drawTier = 0;
		loggedTier.clear();
		const input = new Input({
			source: new BlobSource(file),
			formats: ALL_FORMATS,
		});
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("no video track to proxy");
		const sourceRealtime = await benchmarkDecode(track);
		const size = shrinkToLongEdge(
			track.displayWidth,
			track.displayHeight,
			pickLongEdge(sourceRealtime),
		);
		const codec = await pickCodec(size.width, size.height);
		// Posted before the encode: the size is what the UI shows for the whole transcode.
		post({ type: "sized", id, width: size.width, height: size.height });
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat(), target });
		const conversion = await Conversion.init({
			input,
			output,
			video: {
				// The track's own size, scaled, so "fill" can only stretch by a rounding difference.
				width: size.width,
				height: size.height,
				fit: "fill",
				quality: PROXY_QUALITY,
				keyFrameInterval: KEY_FRAME_INTERVAL,
				...(codec ? { codec } : {}),
				// Deliberately no hardwareAcceleration hint: it rides into the encoder config, where
				// a browser without hardware encoding for that codec rejects the whole job.
			},
		});
		conversions.set(id, conversion);
		// A discarded video track leaves an audio-only conversion whose execute() throws.
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
		const blob = new Blob([target.buffer], { type: "video/mp4" });
		await reportProxy(blob, sourceRealtime);
		post({ type: "done", id, blob });
	} catch (error) {
		// Cancel or a mid-stream failure, both read as "no proxy"; nothing else logs.
		conversions.delete(id);
		console.error(`[proxy] conversion ${id} failed`, error);
		post({ type: "failed", id, reason: String(error) });
	}
}
