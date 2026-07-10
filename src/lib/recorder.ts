import {
	FFT_SIZE,
	analyzeFrames,
	applyFrameAudioToEffects,
	decodeAudioFile,
	loopAudioBuffer,
	trimAudioBuffer,
	type FrameAudioData,
} from './audio/offline-audio';
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
	 * May return a Promise. */
	onBeforeRender?: (
		frameIndex: number,
		time: number,
	) => boolean | void | Promise<boolean | void>;
	/** When provided, these effects are used for rendering instead of `effects`. Allows per-frame effect swapping via onBeforeRender. */
	effectsRef?: { current: EffectInstance[] };
	/** When true, the audio is looped to match the recording duration. */
	loopAudio?: boolean;
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
): Promise<{
	frameAudioData: FrameAudioData[];
	sampleRate: number;
	audioBuffer: AudioBuffer;
}> {
	checkAbort(signal);
	const decoded = await decodeAudioFile(audioFile);
	const end = audioEnd ?? duration;
	const trimmed = trimAudioBuffer(decoded, audioStart, end);
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
	const frameAudioData = analyzeFrames(
		loop ? trimmed : audioBuffer,
		frameTimes,
		FFT_SIZE,
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
				bitrate: 4_000_000,
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
			bitrate: 6_000_000,
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
		onProgress?.(Math.min(encodedFrames / totalFrames, 1));
	};

	const makeCanvasSink = (): FrameSink => {
		const videoSource = new mb.CanvasSource(canvas, {
			codec: selectedCodec as any,
			// Software realtime mode trades some per-frame efficiency for multithreaded
			// speed; the higher bitrate compensates so visual quality holds.
			bitrate: hardware ? 4_000_000 : 6_000_000,
			...(hardware
				? { hardwareAcceleration: 'prefer-hardware' as const }
				: { latencyMode: 'realtime' as const }),
			onEncodedPacket: reportPacket,
		});
		output.addVideoTrack(videoSource);
		const queue: Promise<void>[] = [];
		return {
			label: hardware ? 'hardware' : 'software',
			async submit(_frameIndex, time) {
				queue.push(videoSource.add(time, frameDuration));
				if (queue.length >= 8) await queue.shift()!;
			},
			async finish() {
				await Promise.all(queue);
				queue.length = 0;
				videoSource.close();
			},
			dispose() {},
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
				// Above the single-encoder path's 6 Mbps: the extra keyframes at
				// chunk boundaries cost bits, this keeps quality at least on par.
				bitrate: 8_000_000,
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
				bitrate: 128_000,
			},
		);
		if (audioCodec) {
			audioSource = new mb.AudioBufferSource({
				codec: audioCodec as any,
				bitrate: 128_000,
			});
			output.addAudioTrack(audioSource);
		}
	}

	await output.start();

	if (audioSource && audioBufferForMux) {
		await audioSource.add(audioBufferForMux);
		audioSource.close();
	}

	// Per-stage wall-time breakdown, logged after export to locate the
	// bottleneck (source decode vs GL render vs encoder backpressure vs flush).
	const perf = { beforeRender: 0, render: 0, encodeSubmit: 0 };
	const loopStart = performance.now();
	let loopEnd = loopStart;

	try {
		for (let i = 0; i < totalFrames; i++) {
			checkAbort(signal);

			const time = i * frameDuration;
			let t = performance.now();
			const renderResult = onBeforeRender?.(i, time);
			const skipRender = renderResult instanceof Promise ? await renderResult : renderResult;
			perf.beforeRender += performance.now() - t;
			const renderEffects = effectsRef ? effectsRef.current : effects;
			applyFrameAudio(renderEffects, frameAudioData, i, audioSampleRate);
			t = performance.now();
			if (!skipRender) renderer.render(renderEffects, time);
			perf.render += performance.now() - t;
			t = performance.now();
			await sink.submit(i, time);
			perf.encodeSubmit += performance.now() - t;
		}

		loopEnd = performance.now();
		// Encoders flush their remaining pipeline here — packet callbacks keep
		// firing, driving progress the rest of the way to 100%.
		await sink.finish();
		await output.finalize();
	} finally {
		sink.dispose();
	}

	const flushMs = performance.now() - loopEnd;
	const loopMs = loopEnd - loopStart;
	const totalS = (loopMs + flushMs) / 1000;
	console.info(
		`[export] ${selectedCodec} (${sink.label}): ` +
			`${totalFrames} frames in ${totalS.toFixed(1)}s (${(totalFrames / totalS).toFixed(0)} fps)\n` +
			`  avg ms/frame — beforeRender: ${(perf.beforeRender / totalFrames).toFixed(2)}, ` +
			`render: ${(perf.render / totalFrames).toFixed(2)}, ` +
			`encodeSubmit: ${(perf.encodeSubmit / totalFrames).toFixed(2)}, ` +
			`other: ${((loopMs - perf.beforeRender - perf.render - perf.encodeSubmit) / totalFrames).toFixed(2)}\n` +
			`  encoder flush after last frame: ${flushMs.toFixed(0)}ms`,
	);

	onProgress?.(1);
	// Let the UI paint "Creating file..." before blocking on blob creation
	onFinalizing?.();
	await new Promise<void>((r) => requestAnimationFrame(() => r()));

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
	URL.revokeObjectURL(url);
}
