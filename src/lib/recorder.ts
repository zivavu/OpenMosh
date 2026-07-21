import {
	FFT_SIZE,
	analyzeFrames,
	applyFrameAudioToEffects,
	decodeAudioFile,
	loopAudioBuffer,
	trimAudioBuffer,
	type FrameAudioData,
} from './audio/offline-audio';
import { getDecodedAudioBuffer } from './audio/audio-buffer-cache';
import { stretchAudioBuffer } from './audio/time-stretch';
import type { EffectInstance } from './effects';
import type { GlRenderer } from './gl/renderer';

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
	/** When set, audio is decoded and used to drive effects during recording; for WebM it is also muxed into the output. */
	audioFile?: File;
	/** Start time of the audio region in seconds (used for trimming and for effect timeline). */
	audioStart?: number;
	/** End time of the audio region in seconds. */
	audioEnd?: number;
	/** Called before each frame render — use to swap source textures, effects, etc.
	 * Return `true` to skip the default `renderer.render()` call (e.g. when transition already rendered).
	 * Return a function to replace the default render: it is invoked AFTER per-frame
	 * audio data has been applied to the active effects, so custom renders (e.g.
	 * transitions blending two chains) still get fresh audio-linked values.
	 * May return a Promise. */
	onBeforeRender?: (
		frameIndex: number,
		time: number,
	) => boolean | void | (() => void) | Promise<boolean | void | (() => void)>;
	/** When provided, these effects are used for rendering instead of `effects`. Allows per-frame effect swapping via onBeforeRender. */
	effectsRef?: { current: EffectInstance[] };
	/** When true, the audio is looped to match the recording duration. */
	loopAudio?: boolean;
	/** Speed factor applied to the audio via pitch-preserving time-stretch. Defaults to 1. */
	audioSpeed?: number;
	/** Linear gain to apply to audio before FFT analysis and muxing. Defaults to 1.0 (no change). */
	normalizeGain?: number;
}

/** Encoding backend that consumes rendered canvas frames. */
interface FrameSink {
	/** Human-readable backend name for the perf log. */
	label: string;
	/** Capture the current canvas state as frame `frameIndex`. Applies its own backpressure. */
	submit(frameIndex: number, time: number): Promise<void> | void;
	/** Wait until every packet has been encoded and handed to the muxer, then close the video source. */
	finish(): Promise<void>;
	/** Release resources (idempotent; used on abort/error paths). */
	dispose(): void;
}

function checkAbort(signal?: AbortSignal) {
	if (signal?.aborted)
		throw new DOMException('Recording cancelled', 'AbortError');
}

function applyFrameAudio(
	effects: EffectInstance[],
	frameAudioData: FrameAudioData[],
	i: number,
	sampleRate: number,
): void {
	if (frameAudioData.length > 0) {
		applyFrameAudioToEffects(effects, frameAudioData[i]!, sampleRate, FFT_SIZE);
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
	// Apply normalize gain before analyzeFrames so FFT and muxed audio are consistent.
	// trimmed: used by analyzeFrames when loop=true
	// audioBuffer: distinct looped copy used for muxing when loop=true; same object as trimmed when loop=false
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

async function recordWebM(opts: RecordOptions): Promise<Blob> {
	const mb = await import('mediabunny');

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
		onBeforeRender,
		effectsRef,
		loopAudio,
		normalizeGain = 1.0,
		audioSpeed = 1,
	} = opts;
	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;

	// Resolve audio buffer and per-frame analysis when user provided audio
	let audioBufferForMux: AudioBuffer | null = null;
	let frameAudioData: FrameAudioData[] = [];
	let audioSampleRate = 0;

	if (audioFile) {
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

	// Prefer a hardware encoder (VP9/AV1 on most modern GPUs): far faster than
	// software VP8 and equal-or-better quality at these bitrates.
	const hwCandidates = (['vp9', 'av1'] as const).filter((c) =>
		containerCodecs.includes(c as any),
	);
	let selectedCodec: string | null = null;
	let hardware = false;
	for (const c of hwCandidates) {
		if (
			await mb.canEncodeVideo(c as any, {
				width: canvas.width,
				height: canvas.height,
				bitrate: 8_000_000,
				hardwareAcceleration: 'prefer-hardware',
			})
		) {
			selectedCodec = c;
			hardware = true;
			break;
		}
	}

	const swCandidates = (['vp8', 'vp9', 'av1'] as const).filter((c) =>
		containerCodecs.includes(c as any),
	);
	if (!selectedCodec) {
		selectedCodec = await mb.getFirstEncodableVideoCodec(swCandidates as any, {
			width: canvas.width,
			height: canvas.height,
			bitrate: 12_000_000,
		});
	}

	if (!selectedCodec) {
		throw new Error(
			`Your browser cannot encode WEBM video. ` +
				`Tried codecs: ${swCandidates.join(', ')}. Try a different browser.`,
		);
	}

	const target = new mb.BufferTarget();
	const output = new mb.Output({ format: outputFormat, target });

	const wantsAudioTrack = audioBufferForMux != null;
	// Progress tracks encoded packets (1 per frame), not submitted frames, so the
	// bar reflects the real bottleneck and "Creating file" doesn't appear stuck.
	let encodedFrames = 0;
	const reportPacket = () => {
		encodedFrames++;
		// Audio analysis gets the first 15% of the bar; encoding fills the rest.
		onProgress?.(Math.min(0.15 + encodedFrames / totalFrames * 0.85, 1));
	};

	const makeCanvasSink = (): FrameSink => {
		let resolveFirstPacket: (() => void) | null = null;
		const firstPacket = new Promise<void>((r) => (resolveFirstPacket = r));
		// videoSource.add() resolves on hand-off to the encoder, not on actual
		// completion, so it cannot be used as backpressure by itself — submitting
		// as fast as we render can outrun the encoder's real drain rate (measured:
		// ~170fps submit vs ~19fps hardware AV1 drain at 2560x1440), building an
		// unbounded backlog of full-resolution frames that exhausts GPU memory and
		// crashes the whole tab (driver TDR -> CONTEXT_LOST_WEBGL). Gate submission
		// on encodedFrames, the only signal tied to real encoder completion.
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
						reject(new DOMException('Recording cancelled', 'AbortError'));
						return;
					}
					signal.addEventListener(
						'abort',
						() => {
							reject(new DOMException('Recording cancelled', 'AbortError'));
							abortWait();
						},
						{ once: true },
					);
			  })
			: null;
		const abortOrNever = abortPromise ?? never;
		const videoSource = new mb.CanvasSource(canvas, {
			codec: selectedCodec as any,
			// Software realtime mode trades some per-frame efficiency for multithreaded
			// speed; the higher bitrate compensates so visual quality holds.
			bitrate: hardware ? 8_000_000 : 12_000_000,
			...(hardware
				? { hardwareAcceleration: 'prefer-hardware' as const }
				: { latencyMode: 'realtime' as const }),
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
			label: hardware ? 'hardware' : 'software',
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
				// Chromium hardware encoders can process the first frames out of
				// order (startup race), emitting frame 1 as the stream's keyframe
				// with frame 0 as a delta after it — which the muxer rejects. Holding
				// frame 1 until frame 0's packet is out makes the swap impossible.
				// The timeout keeps encoders that buffer before emitting from
				// stalling the export.
				if (frameIndex === 0) {
					await Promise.race([
						firstPacket,
						new Promise<void>((r) => setTimeout(r, 1000)),
						abortOrNever,
						queueErrorPromise,
					]);
				}
				if (queue.length >= 8) {
					await Promise.race([
						queue.shift()!,
						abortOrNever,
						queueErrorPromise,
					]);
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

	// Software encoding is mostly single-pipeline per encoder instance, so a
	// pool of worker-thread VP8 encoders scales throughput with CPU cores.
	// Chunks of frames go round-robin to workers; each chunk starts with a
	// forced keyframe so the interleaved streams stay valid.
	const makePoolSink = async (): Promise<FrameSink> => {
		const { EncoderPool } = await import('./encode-pool/encode-pool');
		if (!EncoderPool.isSupported())
			throw new Error('Workers or WebCodecs unavailable');
		const CHUNK_SIZE = 24;
		const workerCount = Math.min(
			4,
			Math.max(2, Math.floor((navigator.hardwareConcurrency || 8) / 4)),
			Math.max(1, Math.ceil(totalFrames / CHUNK_SIZE)),
		);
		if (workerCount < 2)
			throw new Error('Export too short to benefit from the encode pool');
		let packetSource: InstanceType<typeof mb.EncodedVideoPacketSource>;
		let drain: Promise<void> = Promise.resolve();
		let drainError: unknown = null;
		let first = true;
		const pool = new EncoderPool({
			config: {
				codec: 'vp8',
				width: canvas.width,
				height: canvas.height,
				// Match the software canvas-sink bitrate so exports are consistent.
				bitrate: 12_000_000,
				latencyMode: 'realtime',
			},
			workerCount,
			chunkSize: CHUNK_SIZE,
			onPacket: (p) => {
				const meta = first
					? {
							decoderConfig: p.decoderConfig ?? {
								codec: 'vp8',
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
		// Init before adding the track: if workers fail to start we fall back to
		// the canvas sink, and the output must not end up with two video tracks.
		await pool.init();
		packetSource = new mb.EncodedVideoPacketSource('vp8');
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
	if (!hardware && selectedCodec === 'vp8') {
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
		const preferredAudio = ['opus', 'vorbis'] as const;
		const audioCandidates = preferredAudio.filter((c) =>
			supportedAudio.includes(c as any),
		);
		const audioCodec = await mb.getFirstEncodableAudioCodec(
			audioCandidates as any,
			{
				numberOfChannels: audioBufferForMux.numberOfChannels,
				sampleRate: audioBufferForMux.sampleRate,
				bitrate: 256_000,
			},
		);
		if (audioCodec) {
			audioSource = new mb.AudioBufferSource({
				codec: audioCodec as any,
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

	try {
		for (let i = 0; i < totalFrames; i++) {
			checkAbort(signal);

			const time = i * frameDuration;
			const renderResult = onBeforeRender?.(i, time);
			const skipRender = renderResult instanceof Promise ? await renderResult : renderResult;
			const renderEffects = effectsRef ? effectsRef.current : effects;
			applyFrameAudio(renderEffects, frameAudioData, i, audioSampleRate);
			if (typeof skipRender === 'function') skipRender();
			else if (!skipRender) renderer.render(renderEffects, time);
			await sink.submit(i, time);
		}

		// Encoders flush their remaining pipeline here — packet callbacks keep
		// firing, driving progress the rest of the way to 100%.
		await sink.finish();
		await output.finalize();
	} finally {
		sink.dispose();
	}

	onProgress?.(1);
	// Let the UI paint "Creating file..." before blocking on blob creation.
	// setTimeout keeps exports alive in background tabs (requestAnimationFrame
	// does not fire when a tab is hidden).
	onFinalizing?.();
	await new Promise<void>((r) => setTimeout(r, 0));

	const mimeType = 'video/webm';
	return new Blob([target.buffer!], { type: mimeType });
}

export async function recordVideo(opts: RecordOptions): Promise<Blob> {
	return recordWebM(opts);
}

export function downloadBlob(blob: Blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `openmosh-${Date.now()}.webm`;
	a.click();
	// Deleting the object URL immediately can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
