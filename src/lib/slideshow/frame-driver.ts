import type { MoshOptions } from "../editor/mosh";
import { loadPresets, type EffectInstance, type Preset } from "../effects";
import type { GlRenderer } from "../gl/renderer";
import {
  DEFAULT_TEXT_OVERLAY_STYLE,
  parsePhrases,
  type TextOverlayConfig,
  type TextOverlayStyle,
} from "../text-overlay";
import { beatAtTime } from "./beat-clock";
import { cloneEffects, computeEffectsForBeat } from "./sequencer";
import type { SlideshowConfig, SlideshowSlide } from "./types";
import type { SlideVideoSampler } from "./video-sampler";

/** beatAtTime's "stopped" sentinel (subdivision 0). */
const HOLD_BEAT = Number.MAX_SAFE_INTEGER;

export interface SlideshowFrameSources {
  /** Decoded image for a slide; undefined while it is still loading. */
  getImage(slide: SlideshowSlide): HTMLImageElement | undefined;
  getSampler(slide: SlideshowSlide): SlideVideoSampler | undefined;
}

export interface SlideshowFrameDriverOptions {
  /** Read live: preview applies config edits mid-playback. */
  getConfig: () => SlideshowConfig;
  getSlides: () => SlideshowSlide[];
  baseEffects: EffectInstance[];
  getMoshOptions: () => MoshOptions;
  /** Read per frame: the preview's renderer is rebuilt on WebGL context loss. */
  getRenderer: () => GlRenderer;
  sources: SlideshowFrameSources;
}

export interface SlideshowFrame {
  /** Effect chain to render this frame. */
  effects: EffectInstance[];
  /**
   * Resolves once this frame's video-slide upload has landed, or null when
   * there is nothing to wait for. Export awaits it so each frame renders the
   * exact source frame; preview ignores it so the render loop never blocks.
   */
  ready: Promise<void> | null;
}

/**
 * Beat → frame resolution for the slideshow, shared by the live preview and
 * the export. Both drive the same instance sequentially, so what a preview
 * shows and what an export writes can't drift apart: slide selection, text
 * overlay cadence, per-beat effect computation and video-slide advancement all
 * live here, and the only differences left to the callers are where frames
 * come from and how time is stepped.
 */
export class SlideshowFrameDriver {
  #getConfig: () => SlideshowConfig;
  #getSlides: () => SlideshowSlide[];
  #baseEffects: EffectInstance[];
  #getMoshOptions: () => MoshOptions;
  #getRenderer: () => GlRenderer;
  #sources: SlideshowFrameSources;

  #smoothState: { effects: EffectInstance[] };
  #effects: EffectInstance[];
  /** Presets are read once per run: 'per-image' mode resolves one every beat. */
  #presets: Preset[] | null = null;
  #lastBeatIndex = -1;
  #currentSlideId: string | null = null;
  #lastVideoSlideId: string | null = null;
  #disposed = false;

  // Memoized text-overlay derivations. The style object identity must stay
  // stable across frames — the renderer skips its canvas redraw by comparing
  // the reference it was handed last.
  #phrasesKey: string | null = null;
  #phrases: string[] = [];
  #style: TextOverlayStyle | null = null;

  constructor(opts: SlideshowFrameDriverOptions) {
    this.#getConfig = opts.getConfig;
    this.#getSlides = opts.getSlides;
    this.#baseEffects = opts.baseEffects;
    this.#getMoshOptions = opts.getMoshOptions;
    this.#getRenderer = opts.getRenderer;
    this.#sources = opts.sources;
    this.#smoothState = { effects: cloneEffects(opts.baseEffects) };
    this.#effects = cloneEffects(opts.baseEffects);
  }

  /**
   * Resolve the frame at `time` (seconds on the beat timeline). `videoDt` is
   * the elapsed time to advance a visible video slide by — a wall-clock delta
   * in preview, one frame duration in export; it is ignored on the beat a
   * video slide first appears, so slides resume where they left off.
   */
  advance(time: number, videoDt: number): SlideshowFrame {
    const config = this.#getConfig();
    const slides = this.#getSlides();
    const { index: beatIndex } = beatAtTime(
      Math.max(0, time),
      config.bpm,
      config.beatOffset,
      config.segments,
      config.subdivision,
    );

    // Stopped (subdivision 0): hold the current slide, effects and overlay.
    if (beatIndex === HOLD_BEAT || slides.length === 0) {
      return { effects: this.#effects, ready: null };
    }

    this.#applyTextOverlay(config.textOverlay, beatIndex);

    const slideIndex = config.loop
      ? beatIndex % slides.length
      : Math.min(beatIndex, slides.length - 1);
    const slide = slides[slideIndex];
    if (!slide) return { effects: this.#effects, ready: null };

    if (beatIndex !== this.#lastBeatIndex) {
      this.#lastBeatIndex = beatIndex;
      if (slide.kind === "image" && slide.id !== this.#currentSlideId) {
        const img = this.#sources.getImage(slide);
        // A slide still decoding keeps the previous texture and retries on its
        // next beat (currentSlideId only advances once the upload happened).
        if (img?.complete) {
          this.#getRenderer().updateSourceImage(img);
          this.#currentSlideId = slide.id;
        }
      }
      this.#effects = computeEffectsForBeat(
        config,
        slide,
        this.#baseEffects,
        this.#smoothState,
        this.#getMoshOptions(),
        this.#resolvePresets(),
      );
    }

    let ready: Promise<void> | null = null;
    if (slide.kind === "video") {
      ready = this.#advanceVideo(slide, videoDt);
      this.#lastVideoSlideId = slide.id;
      this.#currentSlideId = slide.id;
    } else {
      this.#lastVideoSlideId = null;
    }

    return { effects: this.#effects, ready };
  }

  /** Stop late video uploads from landing after playback ends. */
  dispose() {
    this.#disposed = true;
  }

  #advanceVideo(
    slide: SlideshowSlide,
    videoDt: number,
  ): Promise<void> | null {
    const sampler = this.#sources.getSampler(slide);
    if (!sampler) return null;
    const dt = this.#lastVideoSlideId === slide.id ? videoDt : 0;
    return sampler.next(dt).then((frame) => {
      if (!frame) return;
      if (!this.#disposed) this.#getRenderer().updateSourceFrame(frame);
      frame.close();
    });
  }

  #resolvePresets(): Preset[] {
    if (!this.#presets) this.#presets = loadPresets();
    return this.#presets;
  }

  /**
   * Roll and seed both derive from beatIndex, so a phrase holds for a whole
   * beat and preview and export land on the same phrases at the same times.
   */
  #applyTextOverlay(
    textOverlay: TextOverlayConfig | undefined,
    beatIndex: number,
  ) {
    const phrases = this.#resolvePhrases(textOverlay);
    const style = this.#resolveStyle(textOverlay);
    const chance = Math.max(0, Math.min(1, textOverlay?.chance ?? 0.8));
    const roll = ((beatIndex * 31) % 1000) / 1000;
    if (phrases.length === 0 || !style || roll >= chance) {
      this.#getRenderer().setTextOverlay(null);
      return;
    }
    this.#getRenderer().setTextOverlay(
      phrases[beatIndex % phrases.length] ?? null,
      style,
      {
        layout: textOverlay?.layout ?? "scattered",
        seed: beatIndex,
        blendMode: textOverlay?.blendMode ?? "normal",
        invert: textOverlay?.invert ?? false,
        opacity: textOverlay?.opacity ?? 1,
      },
    );
  }

  #resolvePhrases(textOverlay: TextOverlayConfig | undefined): string[] {
    if (!textOverlay?.enabled || !textOverlay.dictionary?.trim()) return [];
    const key = `${textOverlay.splitBy}:${textOverlay.dictionary}`;
    if (key !== this.#phrasesKey) {
      this.#phrasesKey = key;
      this.#phrases = parsePhrases(textOverlay.dictionary, textOverlay.splitBy);
    }
    return this.#phrases;
  }

  #resolveStyle(
    textOverlay: TextOverlayConfig | undefined,
  ): TextOverlayStyle | null {
    if (textOverlay?.style == null) return null;
    const next = { ...DEFAULT_TEXT_OVERLAY_STYLE, ...textOverlay.style };
    // Compared by value, not identity: the config panel replaces the style
    // object on edit, but keeping the previous instance when nothing actually
    // changed is what lets the renderer skip redrawing the text canvas.
    const prev = this.#style;
    if (prev && (Object.keys(next) as (keyof TextOverlayStyle)[]).every(
      (k) => prev[k] === next[k],
    )) {
      return prev;
    }
    this.#style = next;
    return next;
  }
}
