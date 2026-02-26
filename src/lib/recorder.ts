import type { EffectInstance } from './effects';
import type { GlRenderer } from './gl/renderer';
import {
	analyzeFrames,
	applyFrameAudioToEffects,
	decodeAudioFile,
	trimAudioBuffer,
	type FrameAudioData,
} from './offline-audio';

const FFT_SIZE = 2048;

export type RecordFormat = 'webm' | 'gif';

export interface RecordOptions {
	format: RecordFormat;
	duration: number;
	fps: number;
	canvas: HTMLCanvasElement;
	renderer: GlRenderer;
	effects: EffectInstance[];
	onProgress?: (progress: number) => void;
	/** Called when frame capture is done and finalization (encode drain, mux, blob) is about to start. */
	onFinalizing?: () => void;
	signal?: AbortSignal;
	/**
	 * Explicit separate audio file. Takes priority over the video's own audio.
	 * Decoded and muxed into WebM; also drives effect volume-links for all formats.
	 */
	audioFile?: File;
	/** Start time (seconds) of the selected span within audioFile. */
	audioStart?: number;
	/** End time (seconds) of the selected span within audioFile. */
	audioEnd?: number;
	/**
	 * The source video File object. When no audioFile is provided, the recorder will
	 * attempt to extract the video's own audio track from this file and mux it into
	 * the output (WebM) and use it to drive effect volume-links.
	 */
	sourceVideoFile?: File;
	/** When set, each frame is sourced from this video element by seeking to the frame time. */
	sourceVideo?: HTMLVideoElement;
	/** Start offset (seconds) into the source video for the export span. Frames are seeked to videoSpanStart + time. */
	videoSpanStart?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seekVideoToTime(video: HTMLVideoElement, time: number): Promise<void> {
	return new Promise((resolve) => {
		if (Math.abs(video.currentTime - time) < 0.001) {
			resolve();
			return;
		}
		video.addEventListener('seeked', () => resolve(), { once: true });
		video.currentTime = time;
	});
}

function checkAbort(signal?: AbortSignal) {
	if (signal?.aborted)
		throw new DOMException('Recording cancelled', 'AbortError');
}

interface ResolvedAudio {
	buffer: AudioBuffer | null;
	frameData: FrameAudioData[];
	sampleRate: number;
}

async function resolveAudio(
	opts: RecordOptions,
	totalFrames: number,
	frameDuration: number,
): Promise<ResolvedAudio> {
	const {
		audioFile,
		audioStart = 0,
		audioEnd,
		sourceVideoFile,
		videoSpanStart = 0,
		duration,
		signal,
	} = opts;

	let buffer: AudioBuffer | null = null;
	let sampleRate = 0;

	if (audioFile) {
		checkAbort(signal);
		const decoded = await decodeAudioFile(audioFile);
		const end = audioEnd ?? duration;
		buffer = await trimAudioBuffer(decoded, audioStart, end);
		sampleRate = buffer.sampleRate;
	} else if (sourceVideoFile) {
		checkAbort(signal);
		try {
			const decoded = await decodeAudioFile(sourceVideoFile);
			buffer = await trimAudioBuffer(
				decoded,
				videoSpanStart,
				videoSpanStart + duration,
			);
			sampleRate = buffer.sampleRate;
		} catch {
			// Video has no audio track or the container is not audio-decodable → skip
		}
	}

	let frameData: FrameAudioData[] = [];
	if (buffer) {
		const bufDuration = buffer.duration;
		const frameTimes = Array.from({ length: totalFrames }, (_, i) => {
			const t = i * frameDuration;
			return Math.min(t, Math.max(0, bufDuration - 0.001));
		});
		frameData = analyzeFrames(buffer, frameTimes, FFT_SIZE);
	}

	return { buffer, frameData, sampleRate };
}

// ---------------------------------------------------------------------------
// WebM
// ---------------------------------------------------------------------------

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
		sourceVideo,
		videoSpanStart = 0,
	} = opts;

	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;

	const {
		buffer: audioBufferForMux,
		frameData: frameAudioData,
		sampleRate: audioSampleRate,
	} = await resolveAudio(opts, totalFrames, frameDuration);

	const outputFormat = new mb.WebMOutputFormat();
	const containerCodecs = outputFormat.getSupportedVideoCodecs();
	const videoCandidates = (['vp8', 'vp9', 'av1'] as const).filter((c) =>
		containerCodecs.includes(c as any),
	);

	const selectedVideoCodec = await mb.getFirstEncodableVideoCodec(
		videoCandidates as any,
		{
			width: canvas.width,
			height: canvas.height,
			bitrate: 4_000_000,
		},
	);

	if (!selectedVideoCodec) {
		throw new Error(
			'Your browser cannot encode WebM video. ' +
				`Tried codecs: ${videoCandidates.join(', ')}. Try GIF instead.`,
		);
	}

	const target = new mb.BufferTarget();
	const output = new mb.Output({ format: outputFormat, target });

	const videoSource = new mb.CanvasSource(canvas, {
		codec: selectedVideoCodec as any,
		bitrate: 4_000_000,
	});
	output.addVideoTrack(videoSource);

	let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
	if (audioBufferForMux) {
		const supportedAudio = outputFormat.getSupportedAudioCodecs();
		const audioCandidates = (['opus', 'vorbis'] as const).filter((c) =>
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
		if (frameAudioData.length > 0) {
			applyFrameAudioToEffects(
				effects,
				frameAudioData[i]!,
				audioSampleRate,
				FFT_SIZE,
			);
		}
		if (sourceVideo) {
			const seekTime = Math.min(
				sourceVideo.duration > 0 ? sourceVideo.duration - 0.001 : 0,
				videoSpanStart + time,
			);
			await seekVideoToTime(sourceVideo, seekTime);
			renderer.updateSourceFrame(sourceVideo);
		}
		renderer.render(effects, time);
		encodeQueue.push(videoSource.add(time, frameDuration));

		if (encodeQueue.length >= ENCODE_QUEUE_SIZE) {
			await encodeQueue.shift()!;
		}

		onProgress?.((i + 1) / totalFrames);
	}

	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	onFinalizing?.();

	await Promise.all(encodeQueue);
	videoSource.close();
	await output.finalize();

	return new Blob([target.buffer!], { type: 'video/webm' });
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

const GIF_MAX_WIDTH = 480;
const GIF_WORKER_IN_FLIGHT = 2;

async function recordGif(opts: RecordOptions): Promise<Blob> {
	const {
		duration,
		fps,
		canvas,
		renderer,
		effects,
		onProgress,
		onFinalizing,
		signal,
		sourceVideo,
		videoSpanStart = 0,
	} = opts;

	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;
	const delay = Math.round(1000 / fps);

	// Audio drives effect volume-links even in GIF (no audio mux in GIF format)
	const { frameData: frameAudioData, sampleRate: audioSampleRate } =
		await resolveAudio(opts, totalFrames, frameDuration);

	const scale = canvas.width > GIF_MAX_WIDTH ? GIF_MAX_WIDTH / canvas.width : 1;
	const outW = Math.round(canvas.width * scale);
	const outH = Math.round(canvas.height * scale);

	const tempCanvas = document.createElement('canvas');
	tempCanvas.width = outW;
	tempCanvas.height = outH;
	const ctx = tempCanvas.getContext('2d', { willReadFrequently: true })!;

	const worker = new Worker(
		new URL('./gif-encoder-worker.ts', import.meta.url),
		{ type: 'module' },
	);

	let inFlight = 0;
	let resolveDrain: (() => void) | null = null;
	function waitForCapacity(): Promise<void> {
		if (inFlight < GIF_WORKER_IN_FLIGHT) return Promise.resolve();
		return new Promise((r) => {
			resolveDrain = r;
		});
	}

	const resultPromise = new Promise<ArrayBuffer>((resolve, reject) => {
		worker.onmessage = (
			e: MessageEvent<{ type: string; buffer?: ArrayBuffer }>,
		) => {
			if (e.data.type === 'frame-done') {
				inFlight--;
				if (resolveDrain) {
					resolveDrain();
					resolveDrain = null;
				}
			} else if (e.data.type === 'done') {
				resolve(e.data.buffer!);
			}
		};
		worker.onerror = () => reject(new Error('GIF worker error'));
	});

	worker.postMessage({ type: 'init', width: outW, height: outH, delay });

	for (let i = 0; i < totalFrames; i++) {
		checkAbort(signal);

		const time = i * frameDuration;
		if (frameAudioData.length > 0) {
			applyFrameAudioToEffects(
				effects,
				frameAudioData[i]!,
				audioSampleRate,
				FFT_SIZE,
			);
		}
		if (sourceVideo) {
			const seekTime = Math.min(
				sourceVideo.duration > 0 ? sourceVideo.duration - 0.001 : 0,
				videoSpanStart + time,
			);
			await seekVideoToTime(sourceVideo, seekTime);
			renderer.updateSourceFrame(sourceVideo);
		}
		renderer.render(effects, time);

		ctx.drawImage(canvas, 0, 0, outW, outH);
		const imageData = ctx.getImageData(0, 0, outW, outH);
		const buffer = imageData.data.buffer;

		await waitForCapacity();
		inFlight++;
		worker.postMessage(
			{ type: 'frame', width: outW, height: outH, delay, rgba: buffer },
			[buffer],
		);

		onProgress?.((i + 1) / totalFrames);

		if (i % 2 === 0) {
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
		}
	}

	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	onFinalizing?.();
	worker.postMessage({ type: 'finish' });
	const buffer = await resultPromise;
	worker.terminate();

	return new Blob([buffer], { type: 'image/gif' });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function recordVideo(opts: RecordOptions): Promise<Blob> {
	if (opts.format === 'gif') {
		return recordGif(opts);
	}
	return recordWebM(opts);
}

export function downloadBlob(blob: Blob, format: RecordFormat) {
	const ext = format === 'gif' ? 'gif' : 'webm';
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `openmosh-${Date.now()}.${ext}`;
	a.click();
	URL.revokeObjectURL(url);
}
