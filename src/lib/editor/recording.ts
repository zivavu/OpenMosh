import type { EffectInstance } from "../effects";
import type { GlRenderer } from "../gl/renderer";
import { downloadBlob, recordVideo } from "../recorder";

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
  videoEl: HTMLVideoElement | null;
  videoDuration: number;
  videoSpanStart: number;
  videoSpanEnd: number;
  /** Video playback speed factor (1 = normal). Defaults to 1. */
  videoSpeed?: number;
  file: File;
  onProgress: (p: number) => void;
  onFinalizing: () => void;
  signal: AbortSignal;
  /** Linear normalize gain to apply to audio. Defaults to 1.0. */
  normalizeGain?: number;
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
      "Export duration is too short (minimum 0.1s). Adjust the span.",
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
  const useVideoSourceAudio = isVideo && !hasExplicitAudio;

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
    try {
      const mb = await import("mediabunny");
      const input = new mb.Input({
        source: new mb.BlobSource(file),
        formats: mb.ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (track && track.rotation === 0 && (await track.canDecode())) {
        const sink = new mb.VideoSampleSink(track);
        const totalFrames = Math.ceil(exportDuration * fps);
        // Must yield exactly one timestamp per recorder frame, mirroring the
        // recorder's time formula, so the generator stays in lockstep with
        // onBeforeRender calls.
        const frameTimes = function* () {
          for (let i = 0; i < totalFrames; i++) {
            yield sourceTimeAt(i / fps);
          }
        };
        videoFrames = sink.samplesAtTimestamps(frameTimes());
      }
    } catch {
      videoFrames = null;
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

  const decodeBeforeRender = async () => {
    const { value: sample } = await videoFrames!.next();
    // null/done: no frame at this timestamp — keep the last uploaded one,
    // matching the seek path's freeze-frame behavior.
    if (sample) {
      const frame = sample.toVideoFrame();
      renderer.updateSourceFrame(frame);
      frame.close();
      sample.close();
    }
  };

  try {
    const blob = await recordVideo({
      duration: exportDuration,
      fps,
      canvas,
      renderer,
      normalizeGain,
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
      ...(isVideo &&
        videoEl && {
          onBeforeRender: videoFrames ? decodeBeforeRender : seekBeforeRender,
        }),
    });
    downloadBlob(blob);
  } finally {
    // Stops mediabunny's pre-decode pipeline and closes its decoder on
    // abort/error; no-op when the generator already ran to completion.
    void videoFrames?.return();
  }
}
