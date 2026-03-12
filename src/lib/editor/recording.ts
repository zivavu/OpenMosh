import type { EffectInstance } from '../effects';
import type { GlRenderer } from '../gl/renderer';
import { downloadBlob, recordVideo, type RecordFormat } from '../recorder';

export interface RecordingContext {
	format: RecordFormat;
	fps: number;
	recordDuration: number;
	recordSpanOnly: boolean;
	recordWithAudio: boolean;
	loopVideo: boolean;
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
		recordSpanOnly,
		recordWithAudio,
		loopVideo,
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

	const duration =
		isVideo && videoDuration > 0 && !loopVideo
			? videoSpanEnd - videoSpanStart
			: recordSpanOnly && trackFile && trackDuration > 0
				? spanEnd - spanStart
				: recordDuration;

	const hasExplicitAudio = !!trackFile && trackDuration > 0;
	const hasVolumeLinks = effects.some(
		(e) => e.volumeLinks && Object.keys(e.volumeLinks).length > 0,
	);
	const useAudioFile =
		hasExplicitAudio &&
		(recordWithAudio || hasVolumeLinks);
	const useVideoSourceAudio = isVideo && !hasExplicitAudio && (recordWithAudio || hasVolumeLinks);

	const audioStart = hasExplicitAudio
		? spanStart
		: isVideo
			? videoSpanStart
			: 0;
	const audioEnd = hasExplicitAudio
		? recordSpanOnly
			? spanEnd
			: Math.min(spanStart + duration, trackDuration)
		: isVideo
			? videoSpanEnd
			: duration;

	if (isVideo && videoEl) videoEl.pause();

	const videoSpanDuration = videoSpanEnd - videoSpanStart;
	const recordFps = fps;

	const blob = await recordVideo({
		format,
		duration,
		fps: recordFps,
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
		...(useAudioFile && {
			audioFile: trackFile!,
			audioStart,
			audioEnd,
		}),
		...(useVideoSourceAudio && {
			audioFile: file,
			audioStart,
			audioEnd,
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
