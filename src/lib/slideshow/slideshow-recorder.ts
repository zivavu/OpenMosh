import type { MoshOptions } from "../editor/mosh";
import type { EffectInstance } from "../effects";
import type { GlRenderer } from "../gl/renderer";
import { downloadBlob, recordVideo } from "../recorder";
import { DEFAULT_TEXT_OVERLAY_STYLE, parsePhrases } from "../text-overlay";
import { beatAtTime } from "./beat-clock";
import { cloneEffects, computeEffectsForBeat } from "./sequencer";
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
  const smoothState = { effects: cloneEffects(baseEffects) };

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

  let currentSlideId: string | null = null;
  let lastVideoSlideId: string | null = null;
  const frameDuration = 1 / fps;
  let lastBeatIndex = -1;
  let currentEffects: EffectInstance[] = cloneEffects(baseEffects);
  const effectsRef = { current: currentEffects };

  // Text overlay: parse phrases once
  const textOverlay = config.textOverlay;
  const phrases =
    textOverlay?.enabled && textOverlay.dictionary?.trim()
      ? parsePhrases(textOverlay.dictionary, textOverlay.splitBy)
      : [];
  const style =
    textOverlay?.style != null
      ? { ...DEFAULT_TEXT_OVERLAY_STYLE, ...textOverlay.style }
      : null;
  const textBlendMode = textOverlay?.blendMode ?? "normal";
  const textInvert = textOverlay?.invert ?? false;
  const textOpacity = textOverlay?.opacity ?? 1;
  const textChance = Math.max(0, Math.min(1, textOverlay?.chance ?? 0.8));
  const textLayout = textOverlay?.layout ?? "scattered";

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
    ...(audioFile && { audioFile, audioStart, audioEnd }),
    async onBeforeRender(_frameIndex: number, time: number) {
      // time is 0..duration (recording window); segments use "seconds from
      // audio start" (silent export: the beat clock just starts at 0)
      const timeFromAudioStart = time + (audioFile ? audioStart : 0);
      const { index: beatIndex } = beatAtTime(
        timeFromAudioStart,
        config.bpm,
        config.beatOffset,
        config.segments,
        config.subdivision,
      );

      // Set text overlay phrase for this frame (with chance).
      // Roll and seed are both derived from beatIndex so a phrase holds for a
      // full beat and matches the preview's per-beat cadence exactly.
      const roll = ((beatIndex * 31) % 1000) / 1000;
      const showText = phrases.length > 0 && style && roll < textChance;
      if (showText) {
        const phrase = phrases[beatIndex % phrases.length] ?? null;
        renderer.setTextOverlay(phrase, style, {
          layout: textLayout,
          seed: beatIndex,
          blendMode: textBlendMode,
          invert: textInvert,
          opacity: textOpacity,
        });
      } else {
        renderer.setTextOverlay(null);
      }

      const slideIndex = config.loop
        ? beatIndex % slides.length
        : Math.min(beatIndex, slides.length - 1);
      const slide = slides[slideIndex];

      if (beatIndex !== lastBeatIndex) {
        lastBeatIndex = beatIndex;

        // Switch source texture when slide changes (image slides; video
        // slides upload per-frame below)
        if (slide.id !== currentSlideId && slide.kind === "image") {
          const img = imageMap.get(slide.id);
          if (img) {
            renderer.updateSourceImage(img);
            currentSlideId = slide.id;
          }
        }

        // Compute effects for this beat
        currentEffects = computeEffectsForBeat(
          config,
          slide,
          baseEffects,
          smoothState,
          moshOptions,
        );
        effectsRef.current = currentEffects;
      }

      // Video slides advance by exactly one frame duration while visible,
      // resuming across appearances — mirrors the preview's rAF-delta logic.
      if (slide.kind === "video") {
        const sampler = samplerMap.get(slide.id);
        if (sampler) {
          const dt = lastVideoSlideId === slide.id ? frameDuration : 0;
          const frame = await sampler.next(dt);
          if (frame) {
            renderer.updateSourceFrame(frame);
            frame.close();
          }
        }
        lastVideoSlideId = slide.id;
        currentSlideId = slide.id;
      } else {
        lastVideoSlideId = null;
      }
    },
    });
  } finally {
    for (const sampler of samplerMap.values()) sampler.dispose();
  }

  renderer.clearTextOverlay();
  downloadBlob(blob);
}
