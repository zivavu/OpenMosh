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
// WebM — native MediaRecorder approach (guaranteed browser A/V sync)
// ---------------------------------------------------------------------------

async function recordWebM(opts: RecordOptions): Promise<Blob> {
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
	const frameMs = 1000 / fps;

	const { buffer: audioBuffer, frameData: frameAudioData, sampleRate: audioSampleRate } =
		await resolveAudio(opts, totalFrames, frameDuration);

	checkAbort(signal);

	// Video: auto-capture at target FPS; setTimeout pacing keeps content in sync
	const videoStream = canvas.captureStream(fps);
	const videoTrack = videoStream.getVideoTracks()[0]!;

	const tracks: MediaStreamTrack[] = [videoTrack];

	// Audio: play the decoded buffer through Web Audio and tap the output stream
	let audioCtx: AudioContext | null = null;
	let bufferSourceNode: AudioBufferSourceNode | null = null;
	if (audioBuffer) {
		audioCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate });
		await audioCtx.resume();
		const dest = audioCtx.createMediaStreamDestination();
		bufferSourceNode = audioCtx.createBufferSource();
		bufferSourceNode.buffer = audioBuffer;
		bufferSourceNode.connect(dest);
		tracks.push(dest.stream.getAudioTracks()[0]!);
	}

	const mimeType =
		['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
			(t) => MediaRecorder.isTypeSupported(t),
		) ?? 'video/webm';

	const chunks: Blob[] = [];
	const recorder = new MediaRecorder(new MediaStream(tracks), {
		mimeType,
		videoBitsPerSecond: 4_000_000,
	});
	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};
	const stoppedPromise = new Promise<void>((resolve) => {
		recorder.onstop = () => resolve();
	});

	// Start recorder and audio in the same turn to minimise any offset between them
	recorder.start();
	bufferSourceNode?.start(audioCtx!.currentTime);

	const startWall = performance.now();

	for (let i = 0; i < totalFrames; i++) {
		checkAbort(signal);

		const time = i * frameDuration;

		if (frameAudioData.length > 0) {
			applyFrameAudioToEffects(effects, frameAudioData[i]!, audioSampleRate, FFT_SIZE);
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

		onProgress?.((i + 1) / totalFrames);

		// Pace rendering to real-time FPS so MediaRecorder timestamps stay in sync with audio
		const targetWall = startWall + (i + 1) * frameMs;
		const remaining = targetWall - performance.now();
		if (remaining > 1) await new Promise<void>((r) => setTimeout(r, remaining - 1));
	}

	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	onFinalizing?.();

	recorder.stop();
	await stoppedPromise;
	await audioCtx?.close();

	return new Blob(chunks, { type: 'video/webm' });
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
