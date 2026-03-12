import type { EffectInstance } from '../effects';
import type { GlRenderer } from '../gl/renderer';
import { downloadBlob, recordVideo, type RecordFormat } from '../recorder';

export interface RecordingContext {
	format: RecordFormat;
	fps: number;
	recordDuration: number;
	canvas: HTMLCanvasElement;
	renderer: GlRenderer;
	effects: EffectInstance[];
	trackFile: File | null;
	trackDuration: number;
	spanStart: number;
	spanEnd: number;
	isVideo: boolean;
	videoEl: HTMLVideoElement | null;
	videoDuration: number;
	videoSpanStart: number;
	videoSpanEnd: number;
	file: File;
	onProgress: (p: number) => void;
	onFinalizing: () => void;
	signal: AbortSignal;
}

export async function executeRecording(ctx: RecordingContext): Promise<void> {
	const {
		format,
		fps,
		recordDuration,
		canvas,
		renderer,
		effects,
		trackFile,
		trackDuration,
		spanStart,
		spanEnd,
		isVideo,
		videoEl,
		videoDuration,
		videoSpanStart,
		videoSpanEnd,
		file,
		onProgress,
		onFinalizing,
		signal,
	} = ctx;

	const hasExplicitAudio = !!trackFile && trackDuration > 0;
	const videoSpanDuration = videoSpanEnd - videoSpanStart;

	// Priority: audio span > video span > manual slider
	// Each tier is only used if its span duration > 0
	const exportDuration =
		hasExplicitAudio && spanEnd - spanStart > 0
			? spanEnd - spanStart
			: isVideo && videoDuration > 0 && videoSpanDuration > 0
				? videoSpanDuration
				: recordDuration;

	if (exportDuration < 0.1) {
		throw new Error('Export duration is too short (minimum 0.1s). Adjust the span.');
	}

	// Looping is implicit: loop when video span is shorter than export duration
	const loopVideo = isVideo && videoSpanDuration > 0 && videoSpanDuration < exportDuration;
	const useVideoSourceAudio = isVideo && !hasExplicitAudio;

	const audioStart = hasExplicitAudio ? spanStart : isVideo ? videoSpanStart : 0;
	// When explicit audio is present, audioEnd is always spanEnd (the full selected span)
	const audioEnd = hasExplicitAudio ? spanEnd : isVideo ? videoSpanEnd : exportDuration;

	if (isVideo && videoEl) videoEl.pause();

	const blob = await recordVideo({
		format,
		duration: exportDuration,
		fps,
		canvas,
		renderer,
		effects: effects.map(
			(e): EffectInstance => ({
				...e,
				values: { ...e.values },
				volumeLinks: e.volumeLinks ? { ...e.volumeLinks } : undefined,
			}),
		),
		onProgress,
		onFinalizing,
		signal,
		// Explicit audio track: always include for both mux output and FFT reactivity
		...(hasExplicitAudio && {
			audioFile: trackFile!,
			audioStart,
			audioEnd,
		}),
		// Video source audio: include when no explicit track, loop if video loops
		...(useVideoSourceAudio && {
			audioFile: file,
			audioStart,
			audioEnd,
			...(loopVideo && { loopAudio: true }),
		}),
		...(isVideo &&
			videoEl && {
				onBeforeRender: async (_frameIndex: number, time: number) => {
					const targetTime =
						loopVideo && videoSpanDuration > 0
							? videoSpanStart + (time % videoSpanDuration)
							: Math.min(videoSpanStart + time, videoSpanEnd);
					videoEl!.currentTime = targetTime;
					await new Promise<void>((resolve) => {
						videoEl!.addEventListener('seeked', () => resolve(), { once: true });
					});
					renderer.updateSourceFrame(videoEl!);
				},
			}),
	});
	downloadBlob(blob, format);
}
