import type { EffectInstance } from '../effects';
import type { GlRenderer } from '../gl/renderer';
import { downloadBlob, recordVideo, type RecordFormat } from '../recorder';

export interface RecordingContext {
	format: RecordFormat;
	fps: number;
	recordDuration: number;
	recordSpanOnly: boolean;
	recordWithAudio: boolean;
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
		isVideo && videoDuration > 0
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
		(recordWithAudio || format === 'gif' || hasVolumeLinks);
	const useVideoSourceAudio = isVideo && !hasExplicitAudio && hasVolumeLinks;

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

	const blob = await recordVideo({
		format,
		duration,
		fps: format === 'gif' ? Math.min(fps, 15) : fps,
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
				sourceVideo: videoEl,
				videoSpanStart,
			}),
	});
	downloadBlob(blob, format);
}
