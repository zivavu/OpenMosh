import type { EffectInstance } from './effects';
import type { GlRenderer } from './gl/renderer';
import {
	FFT_SIZE,
	analyzeFrames,
	applyFrameAudioToEffects,
	decodeAudioFile,
	loopAudioBuffer,
	trimAudioBuffer,
	type FrameAudioData,
} from './audio/offline-audio';

export type RecordFormat = 'webm';

export interface RecordOptions {
	format: RecordFormat;
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
	onBeforeRender?: (frameIndex: number, time: number) => boolean | void | Promise<boolean | void>;
	/** When provided, these effects are used for rendering instead of `effects`. Allows per-frame effect swapping via onBeforeRender. */
	effectsRef?: { current: EffectInstance[] };
	/** When true, the audio is looped to match the recording duration. */
	loopAudio?: boolean;
	/** Linear gain to apply to audio before FFT analysis and muxing. Defaults to 1.0 (no change). */
	normalizeGain?: number;
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
	const frameAudioData = analyzeFrames(loop ? trimmed : audioBuffer, frameTimes, FFT_SIZE);
	return { frameAudioData, sampleRate: audioBuffer.sampleRate, audioBuffer };
}

async function recordWebM(opts: RecordOptions): Promise<Blob> {
	const mb = await import('mediabunny');

	const {
		format,
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

	const preferredCodecs = ['vp8', 'vp9', 'av1'] as const;

	const candidates = preferredCodecs.filter((c) =>
		containerCodecs.includes(c as any),
	);

	const selectedCodec = await mb.getFirstEncodableVideoCodec(
		candidates as any,
		{
			width: canvas.width,
			height: canvas.height,
			bitrate: 4_000_000,
		},
	);

	if (!selectedCodec) {
		throw new Error(
			`Your browser cannot encode ${format.toUpperCase()} video. ` +
				`Tried codecs: ${candidates.join(', ')}. Try a different browser.`,
		);
	}

	const target = new mb.BufferTarget();
	const output = new mb.Output({ format: outputFormat, target });

	const wantsAudioTrack = audioBufferForMux != null;
	const videoSource = new mb.CanvasSource(canvas, {
		codec: selectedCodec as any,
		bitrate: 4_000_000,
	});
	output.addVideoTrack(videoSource);

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

	const ENCODE_QUEUE_SIZE = 3;
	const encodeQueue: Promise<void>[] = [];

	for (let i = 0; i < totalFrames; i++) {
		checkAbort(signal);

		const time = i * frameDuration;
		const skipRender = onBeforeRender ? await onBeforeRender(i, time) : false;
		const renderEffects = effectsRef ? effectsRef.current : effects;
		applyFrameAudio(renderEffects, frameAudioData, i, audioSampleRate);
		if (!skipRender) renderer.render(renderEffects, time);
		encodeQueue.push(videoSource.add(time, frameDuration));

		if (encodeQueue.length >= ENCODE_QUEUE_SIZE) {
			await encodeQueue.shift()!;
		}

		onProgress?.((i + 1) / totalFrames);
	}

	// Let the UI paint "Creating file..." before blocking on finalize
	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	onFinalizing?.();

	await Promise.all(encodeQueue);
	encodeQueue.length = 0;
	videoSource.close();

	await output.finalize();

	const mimeType = 'video/webm';
	return new Blob([target.buffer!], { type: mimeType });
}

export async function recordVideo(opts: RecordOptions): Promise<Blob> {
	return recordWebM(opts);
}

export function downloadBlob(blob: Blob, format: RecordFormat) {
	const ext = format;
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `openmosh-${Date.now()}.${ext}`;
	a.click();
	URL.revokeObjectURL(url);
}
