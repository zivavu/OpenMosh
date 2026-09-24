import { getDecodedAudioBuffer } from "./audio/audio-buffer-cache";
import type { AudioLinkGroup } from "./audio/audio-utils";
import {
	type AudioResponse,
	DEFAULT_AUDIO_RESPONSE,
	resetAutoRange,
} from "./audio/auto-range";
import {
	analyzeFrames,
	applyFrameAudioToEffects,
	FFT_SIZE,
	type FrameAudioData,
	loopAudioBuffer,
	trimAudioBuffer,
} from "./audio/offline-audio";
import { resetSpectrumRange } from "./audio/spectrum-range";
import { stretchAudioBuffer } from "./audio/time-stretch";
import {
	type MediaChainSource,
	type MediaTimeline,
	type ResolvedMediaLayer,
	resolveMediaLayersAt,
	type SourceEdit,
} from "./media";
import {
	type ResolvedTextLayer,
	resolveTextLayersAt,
	type TextChainSource,
	type TextTimeline,
} from "./text";

/** Replaces the default render for a frame, and composites its own layers. */
export type CustomRender = (
	textLayers: ResolvedTextLayer[],
	mediaLayers: ResolvedMediaLayer[],
) => void;

import type { StreamTargetChunk, VideoCodec } from "mediabunny";
import type { EffectInstance } from "./effects";
import type { GlRenderer } from "./gl/renderer";

/** Bitrate scales with output size: a fixed rate starves big canvases and bloats
 * small ones. Chrome honors the target, Firefox clamps it. */
const BITS_PER_PIXEL = 0.2;
const MIN_VIDEO_BITRATE = 3_000_000;
const MAX_VIDEO_BITRATE = 60_000_000;

function targetVideoBitrate(
	width: number,
	height: number,
	fps: number,
): number {
	return Math.round(
		Math.min(
			MAX_VIDEO_BITRATE,
			Math.max(MIN_VIDEO_BITRATE, width * height * fps * BITS_PER_PIXEL),
		),
	);
}

export interface RecordOptions {
	duration: number;
	fps: number;
	canvas: HTMLCanvasElement;
	renderer: GlRenderer;
	effects: EffectInstance[];
	onProgress?: (progress: number) => void;
	/** Called when frame capture is done and finalization (mux, blob) begins. */
	onFinalizing?: () => void;
	signal?: AbortSignal;
	/** Decoded to drive effects during recording; for WebM it is also muxed. */
	audioFile?: File;
	/** Start of the audio region in seconds, for trimming and effect timing. */
	audioStart?: number;
	/** End time of the audio region in seconds. */
	audioEnd?: number;
	/** Sound already mixed for the export, in place of `audioFile`: `mix` is muxed,
	 * `drive` is what the effects react to. */
	audioMix?: { mix: AudioBuffer | null; drive: AudioBuffer | null };
	/** Called before each frame render, to swap source textures, effects and so on.
	 * Return `true` to skip the default render, or a function to replace it. */
	onBeforeRender?: (
		frameIndex: number,
		time: number,
	) => boolean | void | CustomRender | Promise<boolean | void | CustomRender>;
	/** Used for rendering instead of `effects`, for per-frame effect swapping. */
	effectsRef?: { current: EffectInstance[] };
	/** Per-frame split of the render chain by audio response, set from
	 * `onBeforeRender`; null applies one response to the whole chain. */
	audioGroupsRef?: { current: AudioLinkGroup[] | null };
	loopAudio?: boolean;
	/** Pitch-preserving time-stretch factor for the audio. Defaults to 1. */
	audioSpeed?: number;
	/** Linear gain applied before FFT analysis and muxing. Defaults to 1. */
	normalizeGain?: number;
	/** How band levels are followed and shaped. Must match the preview. */
	audioResponse?: AudioResponse;
	textTimeline?: TextTimeline | null;
	/** Media lanes, resolved per frame on the same clock as the text lanes. */
	mediaTimeline?: MediaTimeline | null;
	/** Per-source edits, for the rate each media clip runs at. */
	sourceEdits?: Record<string, SourceEdit>;
	/** Uploads each visible layer's frame; awaited, so the written frame is the one asked for. */
	mediaLayerSink?: ((layers: ResolvedMediaLayer[]) => Promise<void>) | null;
	/** Chain per media clip and frame, the export's own; see recording.ts. */
	mediaChains?: MediaChainSource | null;
	/** The same, per text clip. */
	textChains?: TextChainSource | null;
	/** Added to the frame time to reach the timeline's clock (audio span offset). */
	textTimeOffset?: number;
	/** Frame-time-to-master-clock rate, for sources played back off-speed. */
	textTimeScale?: number;
	/** Song tempo, for beat-synced effects. 0 = unknown, they run free. */
	bpm?: number;
	/** Master-clock second the beat grid starts on (slideshow beat offset). */
	beatOffset?: number;
}

/** Encoding backend that consumes rendered canvas frames. */
interface FrameSink {
	/** Human-readable backend name for the perf log. */
	label: string;
	/** Capture the current canvas as frame `frameIndex`. Applies its own backpressure. */
	submit(frameIndex: number, time: number): Promise<void> | void;
	/** Wait until every packet is encoded and handed to the muxer, then close. */
	finish(): Promise<void>;
	/** Release resources (idempotent; used on abort/error paths). */
	dispose(): void;
}

function checkAbort(signal?: AbortSignal) {
	if (signal?.aborted)
		throw new DOMException("Recording cancelled", "AbortError");
}

function applyFrameAudio(
	effects: EffectInstance[],
	frameAudioData: FrameAudioData[],
	i: number,
	sampleRate: number,
	frameDuration: number,
	response: AudioResponse,
	groups?: AudioLinkGroup[] | null,
	/** Groups that do not change frame to frame, so the caller builds them once. */
	fixedGroups?: AudioLinkGroup[] | null,
): void {
	if (frameAudioData.length === 0) return;
	const frame = frameAudioData[i]!;
	// Each group carries its own response and envelope scope, as the preview's
	// per-frame tick does; the ungrouped case is applied directly.
	if (groups) {
		applyGroups(groups, frame, sampleRate, frameDuration);
	} else {
		applyFrameAudioToEffects(
			effects,
			frame,
			sampleRate,
			FFT_SIZE,
			frameDuration,
			response,
		);
	}
	// Layer chains are their own groups either way: they follow the music regardless.
	if (fixedGroups) applyGroups(fixedGroups, frame, sampleRate, frameDuration);
}

function applyGroups(
	groups: AudioLinkGroup[],
	frame: FrameAudioData,
	sampleRate: number,
	frameDuration: number,
): void {
	for (const g of groups) {
		applyFrameAudioToEffects(
			g.effects,
			frame,
			sampleRate,
			FFT_SIZE,
			frameDuration,
			g.response,
			g.scope,
		);
	}
}

async function prepareFrameAudio(
	audioFile: File,
	duration: number,
	totalFrames: number,
	frameDuration: number,
	audioStart: number,
	audioEnd: number | undefined,
	signal?: AbortSignal,
	loop?: boolean,
	normalizeGain: number = 1.0,
	audioSpeed: number = 1,
	onProgress?: (progress: number) => void,
): Promise<{
	frameAudioData: FrameAudioData[];
	sampleRate: number;
	audioBuffer: AudioBuffer;
}> {
	checkAbort(signal);
	const decoded = await getDecodedAudioBuffer(audioFile);
	const end = audioEnd ?? duration;
	// Stretch before looping so the loop length matches the sped-up video span.
	const trimmed = stretchAudioBuffer(
		trimAudioBuffer(decoded, audioStart, end),
		audioSpeed,
	);
	const audioBuffer = loop ? loopAudioBuffer(trimmed, duration) : trimmed;
	// Normalize gain goes on before analyzeFrames, so FFT and muxed audio agree.
	// When looping, `trimmed` feeds the analysis and `audioBuffer` is muxed.
	if (normalizeGain !== 1.0) {
		const buffersToScale = loop ? [trimmed, audioBuffer] : [audioBuffer];
		for (const buf of buffersToScale) {
			for (let ch = 0; ch < buf.numberOfChannels; ch++) {
				const data = buf.getChannelData(ch);
				for (let i = 0; i < data.length; i++) data[i] *= normalizeGain;
			}
		}
	}
	const loopDuration = trimmed.duration;
	const frameTimes = Array.from({ length: totalFrames }, (_, i) => {
		const t = i * frameDuration;
		if (loop && loopDuration > 0) return t % loopDuration;
		return Math.min(t, Math.max(0, loopDuration - 0.001));
	});
	const frameAudioData = await analyzeFrames(
		loop ? trimmed : audioBuffer,
		frameTimes,
		FFT_SIZE,
		onProgress,
	);
	return { frameAudioData, sampleRate: audioBuffer.sampleRate, audioBuffer };
}

// Blob's ArrayBuffer branch refuses anything over 2 GB, so a long export can't be
// handed to it as one buffer; the muxer's writes land in fixed-size slabs instead.
const SLAB_SIZE = 64 * 1024 * 1024;

class SlabBuffer {
	private slabs: Uint8Array<ArrayBuffer>[] = [];
	/** Highest byte offset written so far: the final file length. */
	length = 0;

	// Writes are not append-only: the muxer seeks back to patch the header and cues.
	write(data: Uint8Array, position: number) {
		const end = position + data.byteLength;
		while (this.slabs.length * SLAB_SIZE < end) {
			this.slabs.push(new Uint8Array(SLAB_SIZE));
		}
		let offset = position;
		let read = 0;
		while (read < data.byteLength) {
			const slab = this.slabs[Math.floor(offset / SLAB_SIZE)]!;
			const within = offset % SLAB_SIZE;
			const n = Math.min(SLAB_SIZE - within, data.byteLength - read);
			slab.set(data.subarray(read, read + n), within);
			read += n;
			offset += n;
		}
		if (end > this.length) this.length = end;
	}

	toBlob(type: string): Blob {
		const parts: BlobPart[] = [];
		for (let i = 0; i < this.slabs.length; i++) {
			const start = i * SLAB_SIZE;
			if (start >= this.length) break;
			const n = Math.min(SLAB_SIZE, this.length - start);
			const slab = this.slabs[i]!;
			parts.push(n === SLAB_SIZE ? slab : slab.subarray(0, n));
		}
		const blob = new Blob(parts, { type });
		// The Blob owns a copy now; drop ours so the slabs can be collected.
		this.slabs = [];
		return blob;
	}
}

async function recordWebM(opts: RecordOptions): Promise<Blob> {
	const mb = await import("mediabunny");

	const {
		duration,
		fps,
		canvas,
		renderer,
		effects,
		onProgress,
		onFinalizing,
		signal,
		audioFile,
		audioStart = 0,
		audioEnd,
		audioMix,
		onBeforeRender,
		effectsRef,
		audioGroupsRef,
		loopAudio,
		normalizeGain = 1.0,
		audioSpeed = 1,
		audioResponse = DEFAULT_AUDIO_RESPONSE,
		textTimeline = null,
		mediaTimeline = null,
		sourceEdits,
		mediaLayerSink = null,
		mediaChains = null,
		textChains = null,
		textTimeOffset = 0,
		textTimeScale = 1,
		bpm = 0,
		beatOffset = 0,
	} = opts;
	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;

	// 4:2:0 video encoders reject odd frame sizes; drop a pixel rather than fail.
	const evenW = Math.max(2, canvas.width & ~1);
	const evenH = Math.max(2, canvas.height & ~1);
	if (evenW !== canvas.width || evenH !== canvas.height) {
		renderer.resize(evenW, evenH);
	}
	const bitrate = targetVideoBitrate(canvas.width, canvas.height, fps);

	let audioBufferForMux: AudioBuffer | null = null;
	let frameAudioData: FrameAudioData[] = [];
	let audioSampleRate = 0;

	if (audioMix) {
		audioBufferForMux = audioMix.mix;
		const drive = audioMix.drive;
		if (drive) {
			const last = Math.max(0, drive.duration - 0.001);
			const frameTimes = Array.from({ length: totalFrames }, (_, i) =>
				Math.min(i * frameDuration, last),
			);
			frameAudioData = await analyzeFrames(drive, frameTimes, FFT_SIZE, (p) =>
				onProgress?.(p * 0.15),
			);
			audioSampleRate = drive.sampleRate;
		}
	} else if (audioFile) {
		const audio = await prepareFrameAudio(
			audioFile,
			duration,
			totalFrames,
			frameDuration,
			audioStart,
			audioEnd,
			signal,
			loopAudio,
			normalizeGain,
			audioSpeed,
			(p) => onProgress?.(p * 0.15),
		);
		audioBufferForMux = audio.audioBuffer;
		frameAudioData = audio.frameAudioData;
		audioSampleRate = audio.sampleRate;
	}

	const outputFormat = new mb.WebMOutputFormat();

	const containerCodecs = outputFormat.getSupportedVideoCodecs();

	// Prefer a hardware encoder (VP9/AV1 on most modern GPUs): far faster than software VP8.
	const hwCandidates = (["vp9", "av1"] as const).filter((c) =>
		containerCodecs.includes(c),
	);
	let selectedCodec: VideoCodec | null = null;
	let hardware = false;
	for (const c of hwCandidates) {
		if (
			await mb.canEncodeVideo(c, {
				width: canvas.width,
				height: canvas.height,
				bitrate,
				hardwareAcceleration: "prefer-hardware",
			})
		) {
			selectedCodec = c;
			hardware = true;
			break;
		}
	}

	const swCandidates = (["vp8", "vp9", "av1"] as const).filter((c) =>
		containerCodecs.includes(c),
	);
	if (!selectedCodec) {
		selectedCodec = await mb.getFirstEncodableVideoCodec(swCandidates, {
			width: canvas.width,
			height: canvas.height,
			bitrate,
		});
	}

	if (!selectedCodec) {
		throw new Error(
			`This browser can't encode WEBM video. ` +
				`Tried ${swCandidates.join(", ")}. Try another browser.`,
		);
	}

	const slabs = new SlabBuffer();
	// Chunked so the muxer batches its writes instead of calling us per packet.
	const target = new mb.StreamTarget(
		new WritableStream<StreamTargetChunk>({
			write(chunk) {
				slabs.write(chunk.data, chunk.position);
			},
		}),
		{ chunked: true },
	);
	const output = new mb.Output({ format: outputFormat, target });

	const wantsAudioTrack = audioBufferForMux != null;
	// Progress tracks encoded packets, not submitted frames (the real bottleneck).
	let encodedFrames = 0;
	const reportPacket = () => {
		encodedFrames++;
		// Audio analysis gets the first 15% of the bar; encoding fills the rest.
		onProgress?.(Math.min(0.15 + (encodedFrames / totalFrames) * 0.85, 1));
	};

	const makeCanvasSink = (): FrameSink => {
		let resolveFirstPacket: (() => void) | null = null;
		const firstPacket = new Promise<void>((r) => (resolveFirstPacket = r));
		// videoSource.add() resolves on hand-off, not completion, so it is no backpressure:
		// submitting as fast as we render outruns the encoder and exhausts GPU memory.
		const MAX_BACKLOG = 16;
		let resolveWait: (() => void) | null = null;
		let rejectWait: ((reason?: unknown) => void) | null = null;
		const notifyPacket = () => {
			resolveWait?.();
			resolveWait = null;
			rejectWait = null;
		};
		const abortWait = (reason?: unknown) => {
			rejectWait?.(reason);
			resolveWait = null;
			rejectWait = null;
		};
		const never = new Promise<never>(() => {});
		const abortPromise = signal
			? new Promise<never>((_, reject) => {
					if (signal.aborted) {
						reject(new DOMException("Recording cancelled", "AbortError"));
						return;
					}
					signal.addEventListener(
						"abort",
						() => {
							reject(new DOMException("Recording cancelled", "AbortError"));
							abortWait();
						},
						{ once: true },
					);
				})
			: null;
		const abortOrNever = abortPromise ?? never;
		const videoSource = new mb.CanvasSource(canvas, {
			codec: selectedCodec,
			bitrate,
			...(hardware
				? { hardwareAcceleration: "prefer-hardware" as const }
				: { latencyMode: "realtime" as const }),
			onEncodedPacket: () => {
				resolveFirstPacket?.();
				resolveFirstPacket = null;
				reportPacket();
				notifyPacket();
			},
		});
		output.addVideoTrack(videoSource);
		const queue: Promise<void>[] = [];
		let queueError: Error | null = null;
		let rejectQueueError: ((err: Error) => void) | null = null;
		const queueErrorPromise = new Promise<never>((_, reject) => {
			rejectQueueError = reject;
		});
		return {
			label: hardware ? "hardware" : "software",
			async submit(frameIndex, time) {
				if (queueError) throw queueError;
				checkAbort(signal);
				const addPromise = videoSource.add(time, frameDuration);
				queue.push(addPromise);
				addPromise.catch((err) => {
					if (queueError) return;
					queueError = err instanceof Error ? err : new Error(String(err));
					rejectQueueError?.(queueError);
					abortWait(queueError);
				});
				// Chromium hardware encoders can emit frame 1 as the keyframe with frame 0 as a
				// delta after it, which the muxer rejects; hold frame 1 until frame 0's packet is out.
				if (frameIndex === 0) {
					await Promise.race([
						firstPacket,
						new Promise<void>((r) => setTimeout(r, 1000)),
						abortOrNever,
						queueErrorPromise,
					]);
				}
				if (queue.length >= 8) {
					await Promise.race([queue.shift()!, abortOrNever, queueErrorPromise]);
				}
				while (frameIndex - encodedFrames > MAX_BACKLOG) {
					checkAbort(signal);
					if (queueError) throw queueError;
					await Promise.race([
						new Promise<void>((resolve, reject) => {
							resolveWait = resolve;
							rejectWait = reject;
						}),
						abortOrNever,
					]);
				}
			},
			async finish() {
				try {
					await Promise.all(queue);
				} finally {
					queue.length = 0;
					videoSource.close();
				}
			},
			dispose() {
				videoSource.close();
			},
		};
	};

	// Software encoding is single-pipeline per encoder, so a pool of worker-thread VP8
	// encoders scales with CPU cores; chunks go round-robin, each with a forced keyframe.
	const makePoolSink = async (): Promise<FrameSink> => {
		const { EncoderPool } = await import("./encode-pool/encode-pool");
		if (!EncoderPool.isSupported())
			throw new Error("Workers or WebCodecs unavailable");
		const CHUNK_SIZE = 24;
		const workerCount = Math.min(
			4,
			Math.max(2, Math.floor((navigator.hardwareConcurrency || 8) / 4)),
			Math.max(1, Math.ceil(totalFrames / CHUNK_SIZE)),
		);
		if (workerCount < 2)
			throw new Error("Export too short to benefit from the encode pool");
		let packetSource: InstanceType<typeof mb.EncodedVideoPacketSource>;
		let drain: Promise<void> = Promise.resolve();
		let drainError: unknown = null;
		let first = true;
		const pool = new EncoderPool({
			config: {
				codec: "vp8",
				width: canvas.width,
				height: canvas.height,
				bitrate,
				latencyMode: "realtime",
			},
			workerCount,
			chunkSize: CHUNK_SIZE,
			onPacket: (p) => {
				const meta = first
					? {
							decoderConfig: p.decoderConfig ?? {
								codec: "vp8",
								codedWidth: canvas.width,
								codedHeight: canvas.height,
							},
						}
					: undefined;
				first = false;
				drain = drain
					.then(() =>
						packetSource.add(
							new mb.EncodedPacket(p.data, p.type, p.timestamp, p.duration),
							meta,
						),
					)
					.then(reportPacket, (err) => {
						drainError = err;
					});
			},
		});
		// Init before adding the track: on worker failure we fall back to the canvas sink.
		await pool.init();
		packetSource = new mb.EncodedVideoPacketSource("vp8");
		output.addVideoTrack(packetSource);
		return {
			label: `worker-pool x${workerCount}`,
			submit: (frameIndex, time) =>
				pool.submit(canvas, frameIndex, time, frameDuration),
			async finish() {
				await pool.flush();
				await drain;
				if (drainError) throw drainError;
				packetSource.close();
				pool.dispose();
			},
			dispose: () => pool.dispose(),
		};
	};

	let sink: FrameSink;
	if (!hardware && selectedCodec === "vp8") {
		try {
			sink = await makePoolSink();
		} catch {
			sink = makeCanvasSink();
		}
	} else {
		sink = makeCanvasSink();
	}

	// Add audio track for WebM when we have audio (add track before start; add data after start)
	let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
	if (wantsAudioTrack && audioBufferForMux) {
		const supportedAudio = outputFormat.getSupportedAudioCodecs();
		const preferredAudio = ["opus", "vorbis"] as const;
		const audioCandidates = preferredAudio.filter((c) =>
			supportedAudio.includes(c),
		);
		const audioCodec = await mb.getFirstEncodableAudioCodec(audioCandidates, {
			numberOfChannels: audioBufferForMux.numberOfChannels,
			sampleRate: audioBufferForMux.sampleRate,
			bitrate: 256_000,
		});
		if (audioCodec) {
			audioSource = new mb.AudioBufferSource({
				codec: audioCodec,
				bitrate: 256_000,
			});
			output.addAudioTrack(audioSource);
		}
	}

	await output.start();

	if (audioSource && audioBufferForMux) {
		await audioSource.add(audioBufferForMux);
		audioSource.close();
	}

	// Otherwise the output's first seconds depend on where the preview was scrubbed.
	resetAutoRange();
	resetSpectrumRange();

	try {
		for (let i = 0; i < totalFrames; i++) {
			checkAbort(signal);

			const time = i * frameDuration;
			const renderResult = onBeforeRender?.(i, time);
			const skipRender =
				renderResult instanceof Promise ? await renderResult : renderResult;
			const renderEffects = effectsRef ? effectsRef.current : effects;
			const clockTime = textTimeOffset + time * textTimeScale;
			const beat = bpm > 0 ? ((clockTime - beatOffset) * bpm) / 60 : null;
			const textLayers = textTimeline
				? resolveTextLayersAt(
						textTimeline,
						clockTime,
						textChains ?? undefined,
						beat,
					)
				: [];
			const mediaLayers = mediaTimeline
				? resolveMediaLayersAt(
						mediaTimeline,
						clockTime,
						sourceEdits,
						mediaChains ?? undefined,
					)
				: [];
			if (mediaLayers.length > 0 && mediaLayerSink) {
				await mediaLayerSink(mediaLayers);
			}
			// The layers' chains are per clip, so they are read off the resolved layers every
			// frame; the lane is the scope, so one lane's smoothing never steps another's.
			const layerGroups = [
				...mediaLayers.map((l) => ({
					scope: l.laneId,
					effects: l.effects,
					response: l.response ?? audioResponse,
				})),
				...textLayers.map((l) => ({
					scope: l.laneId,
					effects: l.effects,
					response: audioResponse,
				})),
			];
			applyFrameAudio(
				renderEffects,
				frameAudioData,
				i,
				audioSampleRate,
				frameDuration,
				audioResponse,
				audioGroupsRef?.current,
				layerGroups.length > 0 ? layerGroups : null,
			);
			// The bars read this straight off the GPU, so push the same bins the preview would.
			renderer.setSpectrum(frameAudioData[i]?.frequencyData ?? null, time);
			// Beat-synced effects read the grid off the same master clock the text lanes do.
			renderer.setBeat(beat, bpm / 60);
			if (typeof skipRender === "function") skipRender(textLayers, mediaLayers);
			else if (!skipRender) {
				renderer.render(renderEffects, time, textLayers, [], mediaLayers);
			}
			await sink.submit(i, time);
		}

		// Encoders flush their remaining pipeline here; packet callbacks drive progress to 100%.
		await sink.finish();
		await output.finalize();
	} finally {
		sink.dispose();
	}

	onProgress?.(1);
	// Let the UI paint "Creating file..." before blocking on blob creation.
	// setTimeout keeps exports alive in background tabs, where rAF doesn't fire.
	onFinalizing?.();
	await new Promise<void>((r) => setTimeout(r, 0));

	return slabs.toBlob("video/webm");
}

export async function recordVideo(opts: RecordOptions): Promise<Blob> {
	return recordWebM(opts);
}

export function downloadBlob(blob: Blob, ext = "webm") {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `openmosh-${Date.now()}.${ext}`;
	a.click();
	// Deleting the object URL immediately can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
