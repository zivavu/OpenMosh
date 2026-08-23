import type { EffectInstance } from "../effects";
import type { GlRenderer } from "../gl/renderer";
import {
  DEFAULT_AUDIO_RESPONSE,
  type AudioResponse,
} from "../audio/auto-range";
import { downloadBlob, recordVideo } from "../recorder";
import { preloadCaptionFonts } from "../caption";
import {
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
import {
  createSequenceEffectSource,
  findSegmentAt,
  resolveTransitionAt,
  type SequenceSegment,
  segmentSourceIdAt,
} from "./sequence";
import { createSequenceExportSources } from "./sequence-export-sources";
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
  /** Sequence mode: per-time effect segments over the master timeline. */
  sequence?: {
    segments: SequenceSegment[];
    moshOptions: MoshOptions;
    /** Master timeline length (audio track duration when masterIsAudio, else video duration). */
    duration: number;
    /** True when an external track drives the clock — segments are keyed to audio time. */
    masterIsAudio: boolean;
    /** Media pool segments draw from. Empty/absent = every segment uses `file`. */
    sources?: SequenceSource[];
    /** Stacked effect lanes, appended to each segment's chain in lane order. */
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

  // Sequence segments carry their own chains, so captions can live outside the
  // base one too.
  await preloadCaptionFonts([
    ...effects,
    ...(ctx.sequence?.segments.flatMap((s) => s.effects) ?? []),
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

  const seekBeforeRender = async (
    _frameIndex: number,
    time: number,
    toMain = true,
    toAlt = false,
  ) => {
    videoEl!.currentTime = sourceTimeAt(time);
    await new Promise<void>((resolve) => {
      videoEl!.addEventListener("seeked", () => resolve(), {
        once: true,
      });
    });
    if (toMain) renderer.updateSourceFrame(videoEl!);
    if (toAlt) renderer.updateAltSourceFrame(videoEl!);
  };

  // `upload` false still pulls a sample: the generator was built to yield one
  // timestamp per recorder frame, so skipping a pull would desynchronise every
  // later frame from `sourceTimeAt`.
  const pullPrimaryFrame = async (upload: boolean, toAlt = false) => {
    const { value: sample } = await videoFrames!.next();
    // null/done: no frame at this timestamp — keep the last uploaded one,
    // matching the seek path's freeze-frame behavior.
    if (sample) {
      if (upload || toAlt) {
        const frame = sample.toVideoFrame();
        if (upload) renderer.updateSourceFrame(frame);
        if (toAlt) renderer.updateAltSourceFrame(frame);
        frame.close();
      }
      sample.close();
    }
  };
  const decodeBeforeRender = () => pullPrimaryFrame(true);

  // Sequence mode: resolve effects per frame from the segment list. With an
  // external track segments live on the audio timeline (master clock) — this
  // covers still images too, where the track is the only clock; otherwise
  // they're keyed by source-video time, honoring speed/looping.
  const sequence = ctx.sequence;
  const seqSource =
    sequence && sequence.segments.length > 0
      ? createSequenceEffectSource(
          () => sequence.segments,
          () => sequence.duration,
          () => sequence.moshOptions,
          { cloneStatic: true },
        )
      : null;
  const seqTimeAt = (time: number): number =>
    sequence?.masterIsAudio ? audioStart + time : sourceTimeAt(time);

  // Stacked lanes append to whatever the source lane resolved. Cloned for the
  // same reason static segments are: this chain gets each frame's audio-link
  // values written into it, and those must not reach the user's clips.
  const fxSource =
    seqSource && (sequence?.fxLanes?.length ?? 0) > 0
      ? createFxLayerSource(() => sequence!.fxLanes, () => sequence!.moshOptions, {
          clone: true,
        })
      : null;
  /** Rebuilt per frame: the base chain under the editor's response, then each
   * active lane under its own — the split the preview's tick makes. */
  const audioGroupsRef: { current: AudioLinkGroup[] | null } = { current: null };
  const effectsRef = seqSource
    ? {
        current: effects.map(
          (e): EffectInstance => ({
            ...e,
            values: { ...e.values },
            volumeLinks: e.volumeLinks ? { ...e.volumeLinks } : undefined,
          }),
        ),
      }
    : undefined;

  // Multi-source sequences: whichever segment is under the playhead picks the
  // media for its frames. Built lazily below so single-source exports (and
  // non-sequence ones) pay nothing.
  let exportSources: Awaited<
    ReturnType<typeof createSequenceExportSources>
  > | null = null;
  const multiSource = (sequence?.sources?.length ?? 0) > 1;
  const primarySourceId = sequence?.sources?.find((s) => s.primary)?.id ?? null;
  /** Registry order, same as the preview reads — see `segmentSourceIdAt`. */
  const sourcePool = sequence?.sources?.map((src) => src.id) ?? [];

  /**
   * Source a transition at `t` is fading out of, or null when there is no
   * transition or both sides use the same media. Mirrors the preview's
   * `outgoingSourceId` — the two must agree or exports drift from what was
   * previewed.
   */
  const outgoingSourceAt = (
    t: number,
    incomingSourceId: string | undefined,
  ): { id: string; time: number } | null => {
    if (!sequence || !seqSource) return null;
    const tr = resolveTransitionAt(
      sequence.segments,
      t,
      sequence.duration,
      seqSource,
    );
    if (!tr) return null;
    const segA = findSegmentAt(
      sequence.segments,
      tr.boundaryTime - 0.001,
      sequence.duration,
    );
    const idA = segmentSourceIdAt(
      segA,
      tr.boundaryTime - 0.001,
      sourcePool,
      primarySourceId,
    );
    const idB = incomingSourceId ?? primarySourceId;
    if (!idA || idA === idB) return null;
    return { id: idA, time: Math.max(0, t - (segA?.startTime ?? 0)) };
  };

  const sequenceBeforeRender = async (frameIndex: number, time: number) => {
    const t = seqTimeAt(time);

    // A non-primary source owns this frame; the primary is still pulled (but
    // not uploaded) so its decode stays in lockstep with the frame clock.
    let primaryOwnsFrame = true;
    // Set when the primary is the *outgoing* side of a transition, so its frame
    // has to reach the alt texture too.
    let primaryIsOutgoing = false;
    const seg = sequence
      ? findSegmentAt(sequence.segments, t, sequence.duration)
      : null;
    const segSourceId =
      segmentSourceIdAt(seg, t, sourcePool, primarySourceId) ?? undefined;
    if (exportSources) {
      // Seconds into the clip, not a per-frame step: the same rule the preview
      // follows, so an export writes the frames that were previewed.
      const out = outgoingSourceAt(t, segSourceId);
      primaryOwnsFrame = !(await exportSources.advance(
        segSourceId,
        Math.max(0, t - (seg?.startTime ?? 0)),
      ));
      primaryIsOutgoing = !(await exportSources.advanceOutgoing(
        out?.id ?? null,
        out?.time ?? 0,
      ));
    }

    // Still images have no per-frame source to advance
    if (isVideo && videoEl) {
      if (videoFrames) {
        await pullPrimaryFrame(primaryOwnsFrame, primaryIsOutgoing);
      } else if (primaryOwnsFrame || primaryIsOutgoing) {
        await seekBeforeRender(frameIndex, time, primaryOwnsFrame, primaryIsOutgoing);
      }
    }
    // On a gap (no segment) keep the previous frame's effects.
    const base = seqSource!(t);
    // The stacked lanes run after the segment's own chain. `effectsRef.current`
    // is the flat form, which is what the recorder writes this frame's
    // audio-link values into — the layers hold the same instances, so the
    // renderer sees those values too.
    const fxLayers = fxSource?.(t) ?? [];
    const stacked = flattenFxLayers(fxLayers);
    const fx = base && stacked.length > 0 ? [...base, ...stacked] : base;
    if (fx) effectsRef!.current = fx;
    audioGroupsRef.current =
      base && fxLayers.length > 0
        ? [
            { scope: "", effects: base, response: audioResponse },
            ...fxLayers.map((layer) => {
              const lane = sequence!.fxLanes!.find((l) => l.id === layer.laneId);
              return {
                scope: layer.laneId,
                effects: layer.effects,
                response: lane
                  ? laneAudioResponse(lane, audioResponse)
                  : audioResponse,
              };
            }),
          ]
        : null;
    // Transition window at a segment boundary: blend the outgoing chain into
    // the incoming one. Returned as a closure so the recorder applies this
    // frame's audio data to `effectsRef.current` (the incoming chain) before
    // the custom render runs; the outgoing chain keeps its boundary-frame
    // values and fades out.
    const tr =
      fx && sequence
        ? resolveTransitionAt(sequence.segments, t, sequence.duration, seqSource!)
        : null;
    if (tr && fx) {
      const progress = (t - tr.boundaryTime) / tr.transition.durationSec;
      const crossFade = outgoingSourceAt(t, segSourceId) !== null;
      // The stacked lanes run over the finished blend, not inside either side
      // of it — the incoming chain is `fx` without that tail. Mirrors what
      // GlCanvas does, so an export matches what was previewed.
      const incoming = stacked.length > 0 ? base! : fx;
      return (textLayers: ResolvedTextLayer[]) =>
        renderer.renderTransition(
          tr.effectsA,
          incoming,
          tr.transition.type,
          progress,
          tr.transition.seed,
          tr.transition.direction ?? 0,
          tr.transition.density ?? 1,
          time,
          crossFade,
          textLayers,
          fxLayers,
        );
    }

    // No transition, but lanes are stacked: render through the same layered
    // call the preview uses, so a lane's fade ramps in the export too. The
    // default path would flatten it into one chain and apply every lane at
    // full strength. `base` carries this frame's audio-link values already —
    // the recorder writes them into effectsRef.current, which holds the very
    // same instances.
    if (fxLayers.length > 0 && base) {
      return (textLayers: ResolvedTextLayer[]) =>
        renderer.render(base, time, textLayers, fxLayers);
    }
  };

  try {
    if (seqSource && multiSource) {
      exportSources = await createSequenceExportSources(
        sequence!.sources!,
        renderer,
      );
    }
    const blob = await recordVideo({
      duration: exportDuration,
      fps,
      canvas,
      renderer,
      normalizeGain,
      audioResponse,
      textTimeline,
      textTimeOffset,
      textTimeScale,
      bpm,
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
        audioSpeed: videoSpeed,
        ...(loopVideo && { loopAudio: true }),
      }),
      ...(seqSource
        ? { onBeforeRender: sequenceBeforeRender }
        : isVideo && videoEl
          ? { onBeforeRender: videoFrames ? decodeBeforeRender : seekBeforeRender }
          : {}),
      ...(effectsRef && { effectsRef, audioGroupsRef }),
    });
    downloadBlob(blob);
  } finally {
    // Stops mediabunny's pre-decode pipeline and closes its decoder on
    // abort/error; no-op when the generator already ran to completion.
    void videoFrames?.return();
    exportSources?.dispose();
  }
}
