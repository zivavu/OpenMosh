import type { MoshOptions } from "../editor/mosh";
import type { EffectInstance } from "../effects";
import type { GlRenderer } from "../gl/renderer";
import { downloadBlob, recordVideo } from "../recorder";
import { preloadCaptionFonts } from "../caption";
import { preloadTextTimelineFonts } from "../text";
import { SlideshowFrameDriver } from "./frame-driver";
import { cloneEffects } from "./sequencer";
import type { SlideshowConfig, SlideshowSlide } from "./types";
import { SlideVideoSampler } from "./video-sampler";

export interface SlideshowRecordContext {
  fps: number;
  slides: SlideshowSlide[];
  config: SlideshowConfig;
  baseEffects: EffectInstance[];
  /** Null = silent export; length then comes from noAudioDuration. */
  audioFile: File | null;
  audioStart: number;
  audioEnd: number;
  /** Export length in seconds when no audio track is set. */
  noAudioDuration?: number;
  /** Linear normalize gain applied to audio before FFT analysis and muxing. */
  normalizeGain?: number;
  canvas: HTMLCanvasElement;
  renderer: GlRenderer;
  /** If set, recording uses these dimensions instead of the first slide's image size. */
  outputWidth?: number;
  outputHeight?: number;
  moshOptions: MoshOptions;
  onProgress: (p: number) => void;
  onFinalizing: () => void;
  signal: AbortSignal;
}

export async function executeSlideshowRecording(
  ctx: SlideshowRecordContext,
): Promise<void> {
  const {
    fps,
    slides,
    config,
    baseEffects,
    audioFile,
    audioStart,
    audioEnd,
    normalizeGain = 1.0,
    canvas,
    renderer,
    outputWidth,
    outputHeight,
    moshOptions,
    onProgress,
    onFinalizing,
    signal,
  } = ctx;

  const duration = audioFile
    ? audioEnd - audioStart
    : Math.max(0.5, ctx.noAudioDuration ?? 5);

  // Pre-load all images; create a fresh sampler per video slide (positions
  // start at 0, matching the preview's reset-on-start)
  const imageMap = new Map<string, HTMLImageElement>();
  const samplerMap = new Map<string, SlideVideoSampler>();
  await Promise.all([
    ...slides
      .filter((s) => s.kind === "image")
      .map(
        (slide) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              imageMap.set(slide.id, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = slide.objectUrl;
          }),
      ),
    ...slides
      .filter((s) => s.kind === "video")
      .map(async (slide) => {
        const sampler = await SlideVideoSampler.create(slide.file);
        if (sampler) samplerMap.set(slide.id, sampler);
      }),
  ]);

  // Set up renderer dimensions from the first slide
  const firstSlide = slides[0];
  if (firstSlide.kind === "video") {
    const sampler = samplerMap.get(firstSlide.id);
    if (sampler) renderer.initVideoSource(sampler.width, sampler.height);
  } else {
    const firstImg = imageMap.get(firstSlide.id);
    if (firstImg) renderer.loadImage(firstImg);
  }
  // Respect user's canvas size if set (otherwise keep first slide dimensions)
  if (
    outputWidth != null &&
    outputHeight != null &&
    outputWidth > 0 &&
    outputHeight > 0
  ) {
    renderer.resize(outputWidth, outputHeight);
  }

  const effectsRef = { current: cloneEffects(baseEffects) };

  // Same driver the preview runs on — slide selection, per-beat effects and
  // video advancement all come from there.
  const driver = new SlideshowFrameDriver({
    getConfig: () => config,
    getSlides: () => slides,
    baseEffects,
    getMoshOptions: () => moshOptions,
    getRenderer: () => renderer,
    sources: {
      getImage: (slide) => imageMap.get(slide.id),
      getSampler: (slide) => samplerMap.get(slide.id),
    },
  });

  await preloadCaptionFonts(baseEffects);
  await preloadTextTimelineFonts(config.text);

  let blob: Blob;
  try {
    blob = await recordVideo({
    duration,
    fps,
    canvas,
    renderer,
    effects: baseEffects,
    effectsRef,
    onProgress,
    onFinalizing,
    signal,
    // Clips are placed against audio time; a silent export starts its beat
    // clock at 0, so the offset follows the same rule the driver uses.
    textTimeline: config.text?.enabled ? config.text : null,
    textTimeOffset: audioFile ? audioStart : 0,
    ...(audioFile && { audioFile, audioStart, audioEnd, normalizeGain }),
    async onBeforeRender(_frameIndex: number, time: number) {
      // time is 0..duration (recording window); segments use "seconds from
      // audio start" (silent export: the beat clock just starts at 0)
      const frame = driver.advance(time + (audioFile ? audioStart : 0));
      // Video slides must have their frame uploaded before this frame renders.
      if (frame.ready) await frame.ready;
      effectsRef.current = frame.effects;
    },
    });
  } finally {
    for (const sampler of samplerMap.values()) sampler.dispose();
  }

  downloadBlob(blob);
}
