import type { EffectInstance } from './effects';
import type { GlRenderer } from './gl/renderer';
import {
	analyzeFrames,
	applyFrameAudioToEffects,
	decodeAudioFile,
	trimAudioBuffer,
	type FrameAudioData,
} from './offline-audio';
// Resolved to asset URLs at build time; actual files only download when ffmpeg.load() is called.
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

const FFT_SIZE = 2048;
const GIF_MAX_WIDTH = 480;
const GIF_WORKER_IN_FLIGHT = 2;

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
	if (Math.abs(video.currentTime - time) < 0.001) return Promise.resolve();
	return new Promise((resolve) => {
		video.addEventListener('seeked', () => resolve(), { once: true });
		video.currentTime = time;
	});
}

function checkAbort(signal?: AbortSignal) {
	if (signal?.aborted)
		throw new DOMException('Recording cancelled', 'AbortError');
}

function nextFrame(): Promise<void> {
	return new Promise((r) => requestAnimationFrame(() => r()));
}

async function decodeAudio(opts: RecordOptions): Promise<AudioBuffer | null> {
	const {
		audioFile,
		audioStart = 0,
		audioEnd,
		sourceVideoFile,
		videoSpanStart = 0,
		duration,
		signal,
	} = opts;

	if (audioFile) {
		checkAbort(signal);
		const decoded = await decodeAudioFile(audioFile);
		return trimAudioBuffer(decoded, audioStart, audioEnd ?? duration);
	}

	if (sourceVideoFile) {
		checkAbort(signal);
		try {
			const decoded = await decodeAudioFile(sourceVideoFile);
			return trimAudioBuffer(decoded, videoSpanStart, videoSpanStart + duration);
		} catch {
			return null;
		}
	}

	return null;
}

function buildFrameAudio(
	audioBuffer: AudioBuffer | null,
	totalFrames: number,
	frameDuration: number,
): { frameData: FrameAudioData[]; sampleRate: number } {
	if (!audioBuffer) return { frameData: [], sampleRate: 0 };
	const frameTimes = Array.from({ length: totalFrames }, (_, i) =>
		Math.min(i * frameDuration, Math.max(0, audioBuffer.duration - 0.001)),
	);
	return {
		frameData: analyzeFrames(audioBuffer, frameTimes, FFT_SIZE),
		sampleRate: audioBuffer.sampleRate,
	};
}

async function renderFrame(
	opts: RecordOptions,
	time: number,
	frameIndex: number,
	frameAudio: { frameData: FrameAudioData[]; sampleRate: number },
) {
	const { renderer, effects, sourceVideo, videoSpanStart = 0 } = opts;

	if (frameAudio.frameData.length > 0) {
		applyFrameAudioToEffects(
			effects,
			frameAudio.frameData[frameIndex]!,
			frameAudio.sampleRate,
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
}

// ---------------------------------------------------------------------------
// FFmpeg lazy singleton
// ---------------------------------------------------------------------------

let ffmpegSingleton: import('@ffmpeg/ffmpeg').FFmpeg | null = null;

async function getFfmpeg(): Promise<import('@ffmpeg/ffmpeg').FFmpeg> {
	if (ffmpegSingleton) return ffmpegSingleton;
	const { FFmpeg } = await import('@ffmpeg/ffmpeg');
	const ffmpeg = new FFmpeg();
	await ffmpeg.load({ coreURL, wasmURL });
	ffmpegSingleton = ffmpeg;
	return ffmpeg;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV file. */
function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const numSamples = buffer.getChannelData(0).length;
	const blockAlign = numChannels * 2;
	const dataSize = numSamples * blockAlign;
	const wav = new ArrayBuffer(44 + dataSize);
	const v = new DataView(wav);
	const str = (off: number, s: string) =>
		[...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));

	str(0, 'RIFF');
	v.setUint32(4, 36 + dataSize, true);
	str(8, 'WAVE');
	str(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, numChannels, true);
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * blockAlign, true);
	v.setUint16(32, blockAlign, true);
	v.setUint16(34, 16, true);
	str(36, 'data');
	v.setUint32(40, dataSize, true);

	const channels = Array.from({ length: numChannels }, (_, c) => buffer.getChannelData(c));
	let off = 44;
	for (let i = 0; i < numSamples; i++) {
		for (let c = 0; c < numChannels; c++) {
			const s = Math.max(-1, Math.min(1, channels[c]![i]!));
			v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			off += 2;
		}
	}
	return new Uint8Array(wav);
}

// ---------------------------------------------------------------------------
// WebM — ffmpeg.wasm frame-by-frame encode + mux (perfect A/V sync)
// ---------------------------------------------------------------------------

async function recordWebM(opts: RecordOptions): Promise<Blob> {
	const { duration, fps, canvas, onProgress, onFinalizing, signal } = opts;

	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;

	const audioBuffer = await decodeAudio(opts);
	const frameAudio = buildFrameAudio(audioBuffer, totalFrames, frameDuration);

	checkAbort(signal);

	const ffmpeg = await getFfmpeg();

	// Render each frame and write to ffmpeg's virtual FS as JPEG
	for (let i = 0; i < totalFrames; i++) {
		checkAbort(signal);
		await renderFrame(opts, i * frameDuration, i, frameAudio);

		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
				'image/jpeg',
				0.92,
			),
		);
		const name = `f${String(i).padStart(6, '0')}.jpg`;
		await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));

		onProgress?.((i + 1) / totalFrames);
		await nextFrame();
	}

	onFinalizing?.();

	if (audioBuffer) {
		await ffmpeg.writeFile('audio.wav', audioBufferToWav(audioBuffer));
	}

	// Build encode command
	const args = ['-framerate', String(fps), '-i', 'f%06d.jpg'];
	if (audioBuffer) args.push('-i', 'audio.wav');
	args.push('-c:v', 'libvpx', '-b:v', '4M', '-pix_fmt', 'yuv420p');
	if (audioBuffer) args.push('-c:a', 'libvorbis', '-b:a', '128k', '-shortest');
	args.push('output.webm');

	await ffmpeg.exec(args);

	const output = (await ffmpeg.readFile('output.webm')) as Uint8Array;

	// Clean up virtual FS for next recording
	for (let i = 0; i < totalFrames; i++) {
		try { await ffmpeg.deleteFile(`f${String(i).padStart(6, '0')}.jpg`); } catch { /* ignore */ }
	}
	try { await ffmpeg.deleteFile('audio.wav'); } catch { /* ignore */ }
	try { await ffmpeg.deleteFile('output.webm'); } catch { /* ignore */ }

	return new Blob([new Uint8Array(output)], { type: 'video/webm' });
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

async function recordGif(opts: RecordOptions): Promise<Blob> {
	const { duration, fps, canvas, onProgress, onFinalizing, signal } = opts;

	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;
	const delay = Math.round(1000 / fps);

	const audioBuffer = await decodeAudio(opts);
	const frameAudio = buildFrameAudio(audioBuffer, totalFrames, frameDuration);

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
		await renderFrame(opts, i * frameDuration, i, frameAudio);

		ctx.drawImage(canvas, 0, 0, outW, outH);
		const imageData = ctx.getImageData(0, 0, outW, outH);
		const rgba = imageData.data.buffer;

		await waitForCapacity();
		inFlight++;
		worker.postMessage({ type: 'frame', width: outW, height: outH, delay, rgba }, [rgba]);

		onProgress?.((i + 1) / totalFrames);

		if (i % 2 === 0) await nextFrame();
	}

	await nextFrame();
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
	return opts.format === 'gif' ? recordGif(opts) : recordWebM(opts);
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
