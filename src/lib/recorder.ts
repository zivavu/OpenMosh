import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import type { EffectInstance } from './effects';
import type { GlRenderer } from './gl/renderer';

export type RecordFormat = 'mp4' | 'webm' | 'gif';

export interface RecordOptions {
	format: RecordFormat;
	duration: number;
	fps: number;
	canvas: HTMLCanvasElement;
	renderer: GlRenderer;
	effects: EffectInstance[];
	onProgress?: (progress: number) => void;
	signal?: AbortSignal;
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
		signal,
	} = opts;
	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;

	const outputFormat =
		format === 'mp4'
			? new mb.Mp4OutputFormat({ fastStart: 'in-memory' })
			: new mb.WebMOutputFormat();

	const containerCodecs = outputFormat.getSupportedVideoCodecs();

	const preferredCodecs =
		format === 'mp4'
			? (['avc', 'hevc', 'av1'] as const)
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

	const videoSource = new mb.CanvasSource(canvas, {
		codec: selectedCodec as any,
		bitrate: 4_000_000,
	});
	output.addVideoTrack(videoSource);

	await output.start();

	for (let i = 0; i < totalFrames; i++) {
		checkAbort(signal);

		const time = i * frameDuration;
		renderer.render(effects, time);
		await videoSource.add(time, frameDuration);

		onProgress?.((i + 1) / totalFrames);
	}

	videoSource.close();
	await output.finalize();

	const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
	return new Blob([target.buffer!], { type: mimeType });
}

const GIF_MAX_WIDTH = 480;

async function recordGif(opts: RecordOptions): Promise<Blob> {
	const { duration, fps, canvas, renderer, effects, onProgress, signal } = opts;
	const totalFrames = Math.ceil(duration * fps);
	const frameDuration = 1 / fps;
	const delay = Math.round(1000 / fps);

	const scale = canvas.width > GIF_MAX_WIDTH ? GIF_MAX_WIDTH / canvas.width : 1;
	const outW = Math.round(canvas.width * scale);
	const outH = Math.round(canvas.height * scale);

	const tempCanvas = document.createElement('canvas');
	tempCanvas.width = outW;
	tempCanvas.height = outH;
	const ctx = tempCanvas.getContext('2d', { willReadFrequently: true })!;

	const gif = GIFEncoder();

	for (let i = 0; i < totalFrames; i++) {
		checkAbort(signal);

		const time = i * frameDuration;
		renderer.render(effects, time);

		ctx.drawImage(canvas, 0, 0, outW, outH);
		const { data } = ctx.getImageData(0, 0, outW, outH);

		const palette = quantize(data, 256);
		const index = applyPalette(data, palette);
		gif.writeFrame(index, outW, outH, { palette, delay });

		onProgress?.((i + 1) / totalFrames);

		if (i % 2 === 0) {
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
		}
	}

	gif.finish();

	const bytes = gif.bytes();
	return new Blob([bytes as unknown as ArrayBuffer], { type: 'image/gif' });
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
