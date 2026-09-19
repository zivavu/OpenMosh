import type { EffectInstance } from "../effects";
import type { GlRenderer } from "../gl/renderer";
import {
	DEFAULT_AUDIO_RESPONSE,
	type AudioResponse,
} from "../audio/auto-range";
import { downloadBlob, recordVideo } from "../recorder";
import { preloadCaptionFonts } from "../caption";
import {
	createTextChainSource,
	preloadTextTimelineFonts,
	type ResolvedTextLayer,
	type TextTimeline,
} from "../text";
import { openDecodableVideo } from "../video/decode";
import type { AudioLinkGroup } from "../audio/audio-utils";
import {
	createFxLayerSource,
	flattenFxLayers,
	laneAudioResponse,
	type FxLane,
} from "./fx-lanes";
import type { MoshOptions } from "./mosh";
import { createMediaExportLayers } from "./media-export-layers";
import { createMediaChainSource, laneSourceIds } from "../media";
import type { MediaTimeline, ResolvedMediaLayer, SourceEdit } from "../media";
import type { SequenceSource } from "./sequence-sources.svelte";

export interface RecordingContext {
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
	/** Whether the source video has an audio track. When false, no audio is decoded/muxed. */
	videoHasAudio: boolean;
	videoEl: HTMLVideoElement | null;
	videoDuration: number;
	videoSpanStart: number;
	videoSpanEnd: number;
	/** Video playback speed factor (1 = normal). Defaults to 1. */
	videoSpeed?: number;
	file: File;
	/** Sequence mode: fx lanes over a blank base, on the master timeline. */
	sequence?: {
		moshOptions: MoshOptions;
		/** Master timeline length (audio track duration when masterIsAudio, else video duration). */
		duration: number;
		/** True when an external track drives the clock — clips are keyed to audio time. */
		masterIsAudio: boolean;
		/** Stacked effect lanes, run in lane order over the layers. */
		fxLanes?: FxLane[];
	} | null;
	onProgress: (p: number) => void;
	onFinalizing: () => void;
	signal: AbortSignal;
	/** Linear normalize gain to apply to audio. Defaults to 1.0. */
	normalizeGain?: number;
	/** How band levels are followed and shaped. Must match the preview. */
	audioResponse?: AudioResponse;
	/** Optional text lanes, keyed to the master clock. */
	textTimeline?: TextTimeline | null;
	/** Optional media lanes, on the same clock. */
	mediaTimeline?: MediaTimeline | null;
	/** What the media clips roll under — an auto clip re-rolls per tick. */
	moshOptions?: MoshOptions;
	/** The pool the media lanes draw from. Both modes have one. */
	layerSources?: SequenceSource[];
	/** Per-source edits: the rate each clip walks its media at.
	 * The crop, key and mask are already on the renderer. */
	sourceEdits?: Record<string, SourceEdit>;
	/** Master-clock time the export's frame 0 lands on. */
	textTimeOffset?: number;
	/** Frame-time-to-master-clock rate (video speed). */
	textTimeScale?: number;
	/** Song tempo, for beat-synced effects. 0 = unknown. */
	bpm?: number;
}

export async function executeRecording(ctx: RecordingContext): Promise<void> {
	const {
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
		videoHasAudio,
		videoEl,
		videoDuration,
		videoSpanStart,
		videoSpanEnd,
		videoSpeed = 1,
		file,
		onProgress,
		onFinalizing,
		signal,
		normalizeGain = 1.0,
		audioResponse = DEFAULT_AUDIO_RESPONSE,
		textTimeline = null,
		mediaTimeline = null,
		moshOptions,
		sourceEdits = {},
		layerSources = [],
		textTimeOffset = 0,
		textTimeScale = 1,
		bpm = 0,
	} = ctx;

	const hasExplicitAudio = !!trackFile && trackDuration > 0;
	const videoSpanDuration = videoSpanEnd - videoSpanStart;
	// Output-time length of the video span once playback speed is applied
	const playedSpanDuration = videoSpanDuration / videoSpeed;

	// Priority: audio span > video span > manual slider
	// Each tier is only used if its span duration > 0
	const exportDuration =
		hasExplicitAudio && spanEnd - spanStart > 0
			? spanEnd - spanStart
			: isVideo && videoDuration > 0 && videoSpanDuration > 0
				? playedSpanDuration
				: recordDuration;

	if (exportDuration < 0.1) {
		throw new Error(
			"That export is too short (0.1s minimum). Widen the span and try again.",
		);
	}

	// Looping is implicit: loop when video span is shorter than export duration
	const loopVideo =
		isVideo && videoSpanDuration > 0 && playedSpanDuration < exportDuration;

	// Map output time to a source-video timestamp, honoring speed + looping
	const sourceTimeAt = (time: number): number => {
		const srcElapsed = time * videoSpeed;
		return loopVideo && videoSpanDuration > 0
			? videoSpanStart + (srcElapsed % videoSpanDuration)
			: Math.min(videoSpanStart + srcElapsed, videoSpanEnd);
	};
	// Only decode the video's own audio when it actually has an audio track;
	// decodeAudioData on a silent file throws and would abort the whole export.
	const useVideoSourceAudio = isVideo && !hasExplicitAudio && videoHasAudio;

	const audioStart = hasExplicitAudio
		? spanStart
		: isVideo
			? videoSpanStart
			: 0;
	// When explicit audio is present, audioEnd is always spanEnd (the full selected span)
	const audioEnd = hasExplicitAudio
		? spanEnd
		: isVideo
			? videoSpanEnd
			: exportDuration;

	if (isVideo && videoEl) videoEl.pause();

	// Every clip carries its own chain, so captions can live outside the base
	// one too.
	await preloadCaptionFonts([
		...effects,
		...(ctx.sequence?.fxLanes ?? []).flatMap((l) =>
			l.clips.flatMap((c) => c.effects),
		),
		...(mediaTimeline?.lanes ?? []).flatMap((l) =>
			l.clips.flatMap((c) => c.effects),
		),
	]);
	await preloadTextTimelineFonts(textTimeline);

	// Sequential WebCodecs decode of the source video: each packet is decoded at
	// most once, vs. the fallback path's full <video> seek per frame (keyframe
	// jump + decode-forward, mostly idle waiting). Falls back to seeking when the
	// file can't be demuxed/decoded, or when rotation metadata is present (the
	// <video> element applies rotation; raw decoded frames would not).
	let videoFrames: AsyncGenerator<
		import("mediabunny").VideoSample | null,
		void,
		unknown
	> | null = null;

	if (isVideo && videoEl) {
		const opened = await openDecodableVideo(file);
		if (opened) {
			const totalFrames = Math.ceil(exportDuration * fps);
			// Must yield exactly one timestamp per recorder frame, mirroring the
			// recorder's time formula, so the generator stays in lockstep with
			// onBeforeRender calls.
			const frameTimes = function* () {
				for (let i = 0; i < totalFrames; i++) {
					yield sourceTimeAt(i / fps);
				}
			};
			videoFrames = opened.sink.samplesAtTimestamps(frameTimes());
		}
	}

	const seekBeforeRender = async (_frameIndex: number, time: number) => {
		videoEl!.currentTime = sourceTimeAt(time);
		await new Promise<void>((resolve) => {
			videoEl!.addEventListener("seeked", () => resolve(), {
				once: true,
			});
		});
		renderer.updateSourceFrame(videoEl!);
	};

	// Single mode's video: one sample per recorder frame, uploaded as it lands.
	// null/done means no frame at this timestamp — keep the last uploaded one,
	// matching the seek path's freeze-frame behavior.
	const decodeBeforeRender = async () => {
		const sample = (await videoFrames!.next()).value;
		if (!sample) return;
		const frame = sample.toVideoFrame();
		renderer.updateSourceFrame(frame);
		frame.close();
		sample.close();
	};

	// Sequence mode: fx lanes over a blank base. Clip times live on the audio
	// timeline (master clock); a video-mastered sequence keys by source time.
	const sequence = ctx.sequence;
	const seqTimeAt = (time: number): number =>
		sequence?.masterIsAudio ? audioStart + time : sourceTimeAt(time);

	// Cloned: this chain gets each frame's audio-link values written into it,
	// and those must not reach the user's clips.
	const fxSource =
		sequence && (sequence.fxLanes?.length ?? 0) > 0
			? createFxLayerSource(
					() => sequence.fxLanes,
					() => sequence.moshOptions,
					{ clone: true },
				)
			: null;
	/** Rebuilt per frame: each active lane under its own response — the split
	 * the preview's tick makes. */
	const audioGroupsRef: { current: AudioLinkGroup[] | null } = {
		current: null,
	};
	const effectsRef = sequence
		? {
				current: effects.map((e): EffectInstance => ({
					...e,
					values: { ...e.values },
					volumeLinks: e.volumeLinks ? { ...e.volumeLinks } : undefined,
				})),
			}
		: undefined;

	let exportLayers: Awaited<ReturnType<typeof createMediaExportLayers>> | null =
		null;

	const sequenceBeforeRender = async (_frameIndex: number, time: number) => {
		const t = seqTimeAt(time);
		// The base is black; the layers are the picture. `effectsRef.current` is
		// the flat form, which is what the recorder writes this frame's
		// audio-link values into — the layers hold the same instances, so the
		// renderer sees those values too.
		const fxLayers = fxSource?.(t) ?? [];
		effectsRef!.current = flattenFxLayers(fxLayers);
		audioGroupsRef.current =
			fxLayers.length > 0
				? fxLayers.map((layer) => {
						const lane = sequence!.fxLanes!.find((l) => l.id === layer.laneId);
						return {
							scope: layer.laneId,
							effects: layer.effects,
							response: lane
								? laneAudioResponse(lane, audioResponse)
								: audioResponse,
						};
					})
				: null;
		// Rendered through the same layered call the preview uses, so a lane's
		// fade ramps in the export too. The default path would flatten it into
		// one chain and apply every lane at full strength.
		return (
			textLayers: ResolvedTextLayer[],
			mediaLayers: ResolvedMediaLayer[],
		) => renderer.render([], time, textLayers, fxLayers, mediaLayers);
	};

	try {
		// Keyed by lane, matching how the preview driver holds its decoders: the
		// lane is what a layer's frames belong to, and two lanes can want two
		// positions in one file. A lane lists every source its clips name, since
		// they need not all be the lane's own.
		const laneSources = new Map<string, string[]>();
		if (mediaTimeline?.enabled) {
			for (const lane of mediaTimeline.lanes) {
				if (!lane.enabled) continue;
				const ids = laneSourceIds(lane);
				if (ids.length > 0) laneSources.set(lane.id, ids);
			}
		}
		if (laneSources.size > 0) {
			exportLayers = await createMediaExportLayers(
				layerSources,
				laneSources,
				renderer,
			);
		}
		// Same resolver the preview builds, so interval rolls reproduce exactly;
		// cloned, so this frame's audio-link values stay out of the clips.
		const mediaChains =
			mediaTimeline && moshOptions
				? createMediaChainSource(() => moshOptions, { clone: true })
				: null;
		const textChains =
			textTimeline && moshOptions
				? createTextChainSource(() => moshOptions, { clone: true })
				: null;
		const blob = await recordVideo({
			duration: exportDuration,
			fps,
			canvas,
			renderer,
			normalizeGain,
			audioResponse,
			textTimeline,
			mediaTimeline: exportLayers ? mediaTimeline : null,
			mediaChains,
			textChains,
			sourceEdits,
			mediaLayerSink: exportLayers
				? (layers) => exportLayers!.advance(layers)
				: null,
			textTimeOffset,
			textTimeScale,
			bpm,
			effects: effects.map((e): EffectInstance => ({
				...e,
				values: { ...e.values },
				volumeLinks: e.volumeLinks ? { ...e.volumeLinks } : undefined,
			})),
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
				audioSpeed: videoSpeed,
				...(loopVideo && { loopAudio: true }),
			}),
			...(sequence
				? { onBeforeRender: sequenceBeforeRender }
				: isVideo && videoEl
					? {
							onBeforeRender: videoFrames
								? decodeBeforeRender
								: seekBeforeRender,
						}
					: {}),
			...(effectsRef && { effectsRef, audioGroupsRef }),
		});
		downloadBlob(blob);
	} finally {
		// Stops mediabunny's pre-decode pipeline and closes its decoder on
		// abort/error; no-op when the generator already ran to completion.
		void videoFrames?.return();
		exportLayers?.dispose();
	}
}
