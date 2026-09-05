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
 * The proxy's size is picked per file: a short decode benchmark runs against
 * the source first, and a machine that can't push it through at twice
 * realtime gets an HD proxy instead of Full HD — a proxy the machine still
 * can't decode comfortably would miss the point.
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
	| { type: "convert"; id: number; file: File }
	| { type: "cancel"; id: number };

export type ProxyWorkerResponse =
	| { type: "progress"; id: number; progress: number }
	| { type: "done"; id: number; blob: Blob }
	| { type: "failed"; id: number; reason: string };

const conversions = new Map<number, Conversion>();

function post(msg: ProxyWorkerResponse, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

/** Long-edge ceiling of a preview proxy on machines that decode comfortably. */
const FHD_LONG_EDGE = 1920;
/** Long-edge ceiling on machines that can't decode the source at 2× realtime. */
const HD_LONG_EDGE = 1280;
/** How much source media the benchmark decodes before judging speed. */
const BENCH_MEDIA_SECONDS = 2;
/** Wall-clock cap on the benchmark — past this the verdict is already clear. */
const BENCH_WALL_MS = 1500;

/**
 * Decode the first moments of a track and time it, as a multiple of realtime —
 * null when the track can't be decoded at all. Measured per file rather than
 * cached per device: decode cost depends on the media as much as on the
 * machine, and the check costs at most BENCH_WALL_MS. Decoder warmup skews the
 * first frames slow, so the number reads low; the safe direction for both
 * things it decides.
 */
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

/**
 * A machine that can't push the source through at twice realtime gets an HD
 * proxy instead of Full HD — a proxy the machine still can't decode
 * comfortably would miss the point. An unmeasurable source is assumed strong.
 */
function pickLongEdge(realtime: number | null): number {
	if (realtime === null) return FHD_LONG_EDGE;
	const weak = realtime < 2;
	console.info(
		`[proxy] source decodes at ${realtime.toFixed(1)}× realtime — ${weak ? "HD" : "Full HD"} proxy`,
	);
	return weak ? HD_LONG_EDGE : FHD_LONG_EDGE;
}

/**
 * Quality of the re-encode.
 *
 * `preferBitrate` is what makes it a *quality* setting rather than a
 * quantizer: left alone, mediabunny encodes a qualitative level with
 * quantizer-based rate control, which puts no ceiling on the result — a
 * QP-based re-encode of clean footage can land above the delivery bitrate of
 * the original, so the proxy ends up more expensive per frame to demux and
 * decode than the thing it stands in for. Bitrate mode pins it near 3 Mbps at
 * 1080p, which is plenty for a preview.
 */
const PROXY_QUALITY = new Quality({ quality: "medium", preferBitrate: true });

/**
 * Seconds between key frames in the proxy, against mediabunny's default of 2.
 *
 * Previews seek constantly — every scrub, every clip edge, and every time a
 * sampler notices decode has fallen behind the clock and jumps to a key frame
 * to catch up (see SlideVideoSampler). Each of those decodes from the
 * preceding key frame forward, so a long interval means a jump can land a
 * couple of seconds of frames away from where the playhead already is; for a
 * sampler that only jumped because it was behind, that is a hole it can dig
 * itself deeper into. Denser key frames cost bitrate, which a preview proxy
 * has to spare.
 */
const KEY_FRAME_INTERVAL = 1;

/**
 * Codecs a proxy may be encoded in, ordered by how likely a decoder is to be
 * cheap. Every one of them is legal in MP4.
 */
const PROXY_CODECS: VideoCodec[] = ["avc", "hevc", "vp9", "av1", "vp8"];

/**
 * Representative codec strings for asking whether a decoder exists in
 * hardware. The proxy's own stream will differ in profile and level, but not
 * in the thing being asked — whether this machine decodes this codec at this
 * size without falling back to the CPU.
 */
const DECODE_PROBES: Record<VideoCodec, string | null> = {
	avc: "avc1.640028", // High 4.0
	hevc: "hvc1.1.6.L120.90", // Main 4.0
	vp9: "vp09.00.10.08", // Profile 0, 8-bit
	av1: "av01.0.05M.08", // Main, level 3.1, 8-bit
	vp8: "vp8",
	prores: null, // Not a browser codec; never a proxy target.
};

/**
 * The codec to encode the proxy in: the first one this machine can both encode
 * *and* decode in hardware. Null hands the choice back to mediabunny.
 *
 * Encodability alone is what mediabunny picks on, and that is how a proxy ends
 * up costing more to play than the source it replaced: a browser with no H.264
 * encoder (Firefox has none) falls through to VP9 or AV1, whose decoders are
 * far more often software-only, while the untouched source was hardware-decoded
 * H.264 the whole time. Downscaling can't win back what a software decoder
 * gives away, so the codec has to be chosen from the playback side.
 */
async function pickCodec(width: number, height: number): Promise<VideoCodec | null> {
	for (const codec of PROXY_CODECS) {
		if (!(await canHardwareDecode(codec, width, height))) continue;
		if (!(await canEncodeVideo(codec, { width, height, quality: PROXY_QUALITY }))) {
			continue;
		}
		console.info(`[proxy] encoding in ${codec} (hardware-decodable here)`);
		return codec;
	}
	// Nothing decodes in hardware — a machine where the proxy's win has to come
	// from pixel count alone. Let mediabunny pick whatever it can encode.
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

/**
 * Even-dimensioned size capping the long edge, never upscaling. Even because
 * H.264 encoders reject odd dimensions.
 */
function shrinkToLongEdge(width: number, height: number, longEdge: number) {
	const scale = Math.min(1, longEdge / Math.max(width, height));
	return {
		width: Math.max(2, Math.round((width * scale) / 2) * 2),
		height: Math.max(2, Math.round((height * scale) / 2) * 2),
	};
}

/**
 * Index of the draw path that last worked; starts on mediabunny's own and is
 * reset per conversion, since what one file's frames reject the next one's may
 * well accept.
 */
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
		// The copy is laid out over the visible rect, which for an anamorphic
		// source is not the display size — sizing the canvas off the latter makes
		// ImageData reject the buffer outright.
		const rect = frame.visibleRect;
		const width = rect?.width ?? frame.codedWidth;
		const height = rect?.height ?? frame.codedHeight;
		const buffer = new Uint8Array(frame.allocationSize({ format: "RGBA" }));
		await frame.copyTo(buffer, { format: "RGBA" });
		const temp = new OffscreenCanvas(width, height);
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

/** Tail of the transform queue — see the transformer below. */
let transforms: Promise<void> = Promise.resolve();

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
	// One frame at a time: the canvas is shared across frames and the fallback
	// tiers await, so two transforms in flight could hand one frame's pixels to
	// the other's sample. A transformer may return a promise.
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
		void convert(msg.id, msg.file);
		return;
	}
	conversions
		.get(msg.id)
		?.cancel()
		.catch(() => {});
};

/**
 * Log what the proxy actually came out as, next to the source it replaces.
 *
 * The whole point of a proxy is that it decodes cheaper, and every input to
 * that — codec, bitrate, whether a hardware decoder took it — is decided by
 * probes and browser fallbacks rather than by anything stated here. Without a
 * number measured on the finished file, a proxy that decodes *slower* than its
 * source looks exactly like one that works. Costs one benchmark per file, and
 * only after the transcode the user was already waiting on.
 */
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
			if (realtime !== null && sourceRealtime !== null && realtime < sourceRealtime) {
				console.warn(
					"[proxy] the proxy decodes slower than the source it replaces",
				);
			}
		} finally {
			input.dispose();
		}
	} catch (error) {
		// Diagnostics only — a proxy that resists measurement still plays.
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
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat(), target });
		const conversion = await Conversion.init({
			input,
			output,
			video: {
				// The size is the track's own, scaled, so a sub-pixel rounding
				// difference is all "fill" can stretch by — "contain" would letterbox.
				width: size.width,
				height: size.height,
				fit: "fill",
				quality: PROXY_QUALITY,
				keyFrameInterval: KEY_FRAME_INTERVAL,
				...(codec ? { codec } : {}),
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
		const blob = new Blob([target.buffer], { type: "video/mp4" });
		await reportProxy(blob, sourceRealtime);
		post({ type: "done", id, blob });
	} catch (error) {
		// Cancel or a mid-stream decode/encode failure — both read as "no proxy".
		// The error is otherwise invisible: nothing here logs on its own.
		conversions.delete(id);
		console.error(`[proxy] conversion ${id} failed`, error);
		post({ type: "failed", id, reason: String(error) });
	}
}
