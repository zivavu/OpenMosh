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

export type RecordFormat = 'mp4' | 'webm' | 'gif';

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
	/** When set, audio is decoded and used to drive effects during recording; for MP4/WebM it is also muxed into the output. */
	audioFile?: File;
	/** Start time of the audio region in seconds (used for trimming and for effect timeline). */
	audioStart?: number;
	/** End time of the audio region in seconds. */
	audioEnd?: number;
	/** When set, each frame is sourced from this video element by seeking to the frame time. */
	sourceVideo?: HTMLVideoElement;
	/** Start offset (seconds) into the source video for the export span. Frames are seeked to videoSpanStart + time. */
	videoSpanStart?: number;
}

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

async function recordMp4WebM(opts: RecordOptions): Promise<Blob> {
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
		sourceVideo,
		videoSpanStart = 0,
	} = opts;
	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;

	// Resolve audio buffer and per-frame analysis when user provided audio
	let audioBufferForMux: AudioBuffer | null = null;
	let frameAudioData: FrameAudioData[] = [];
	let audioSampleRate = 0;

	if (audioFile) {
		checkAbort(signal);
		const decoded = await decodeAudioFile(audioFile);
		const end = audioEnd ?? duration;
		audioBufferForMux = await trimAudioBuffer(decoded, audioStart, end);
		audioSampleRate = audioBufferForMux.sampleRate;
		const trimmedDuration = audioBufferForMux.duration;
		// Per-frame times; cap to trimmed duration so we don't read past buffer; for frames past end use last moment
		const frameTimes = Array.from({ length: totalFrames }, (_, i) => {
			const t = i * frameDuration;
			return Math.min(t, Math.max(0, trimmedDuration - 0.001));
		});
		frameAudioData = analyzeFrames(audioBufferForMux, frameTimes, FFT_SIZE);
	}

	const outputFormat =
		format === 'mp4'
			? new mb.Mp4OutputFormat({ fastStart: 'in-memory' })
			: new mb.WebMOutputFormat();

	const containerCodecs = outputFormat.getSupportedVideoCodecs();

	const preferredCodecs =
		format === 'mp4'
			? (['hevc', 'avc', 'av1'] as const)
			: (['vp8', 'vp9', 'av1'] as const);

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
				`Tried codecs: ${candidates.join(', ')}. Try WebM or GIF instead.`,
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

	// Add audio track for MP4/WebM when we have audio (add track before start; add data after start)
	let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
	if (wantsAudioTrack && audioBufferForMux) {
		const supportedAudio = outputFormat.getSupportedAudioCodecs();
		// MP4: try AAC first (not encodable on all platforms), then Opus. WebM: Opus, then Vorbis.
		const preferredAudio =
			format === 'mp4'
				? (['aac', 'opus'] as const)
				: (['opus', 'vorbis'] as const);
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

	// Let the UI paint "Creating file..." before blocking on finalize
	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	onFinalizing?.();

	await Promise.all(encodeQueue);
	videoSource.close();
	await output.finalize();

	const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
	return new Blob([target.buffer!], { type: mimeType });
}

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
		audioFile,
		audioStart = 0,
		audioEnd,
		sourceVideo,
		videoSpanStart = 0,
	} = opts;
	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;
	const delay = Math.round(1000 / fps);

	// Optional audio-driven effects (no audio mux in GIF)
	let frameAudioData: FrameAudioData[] = [];
	let audioSampleRate = 0;
	if (audioFile) {
		checkAbort(signal);
		const decoded = await decodeAudioFile(audioFile);
		const end = audioEnd ?? duration;
		const trimmed = await trimAudioBuffer(decoded, audioStart, end);
		audioSampleRate = trimmed.sampleRate;
		const trimmedDuration = trimmed.duration;
		const frameTimes = Array.from({ length: totalFrames }, (_, i) => {
			const t = i * frameDuration;
			return Math.min(t, Math.max(0, trimmedDuration - 0.001));
		});
		frameAudioData = analyzeFrames(trimmed, frameTimes, FFT_SIZE);
	}

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
		worker.onmessage = (e: MessageEvent<{ type: string; buffer?: ArrayBuffer }>) => {
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

export async function recordVideo(opts: RecordOptions): Promise<Blob> {
	if (opts.format === 'gif') {
		return recordGif(opts);
	}
	return recordMp4WebM(opts);
}

export function downloadBlob(blob: Blob, format: RecordFormat) {
	const ext = format === 'gif' ? 'gif' : format;
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `openmosh-${Date.now()}.${ext}`;
	a.click();
	URL.revokeObjectURL(url);
}
