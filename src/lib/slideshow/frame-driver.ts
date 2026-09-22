import type { MoshOptions } from "../editor/mosh";
import { loadPresets, type EffectInstance, type Preset } from "../effects";
import type { GlRenderer, SourceImage } from "../gl/renderer";
import { beatAtTime } from "./beat-clock";
import { cloneEffects, computeEffectsForBeat } from "./sequencer";
import type { SlideshowConfig, SlideshowSlide } from "./types";
import type { SlideVideoSampler } from "./video-sampler";

/** beatAtTime's "stopped" sentinel (subdivision 0). */
const HOLD_BEAT = Number.MAX_SAFE_INTEGER;

export interface SlideshowFrameSources {
	getImage(slide: SlideshowSlide): SourceImage | undefined;
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
	/** Whether a video slide's advance may stall waiting for its decoder. Export
	 * needs the exact frame; preview holds the one on screen instead. */
	waitForFrames?: boolean;
}

export interface SlideshowFrame {
	effects: EffectInstance[];
	/** Resolves once this frame's video-slide upload has landed, or null when
	 * there is nothing to wait for. Export awaits it; preview ignores it. */
	ready: Promise<void> | null;
}

/**
 * Beat to frame resolution shared by the live preview and the export, so what a
 * preview shows and what an export writes can't drift apart.
 */
export class SlideshowFrameDriver {
	#getConfig: () => SlideshowConfig;
	#getSlides: () => SlideshowSlide[];
	#baseEffects: EffectInstance[];
	#getMoshOptions: () => MoshOptions;
	#getRenderer: () => GlRenderer;
	#sources: SlideshowFrameSources;
	#waitForFrames: boolean;

	#smoothState: { effects: EffectInstance[] };
	#effects: EffectInstance[];
	/** Presets are read once per run: 'per-image' mode resolves one every beat. */
	#presets: Preset[] | null = null;
	#lastBeatIndex = -1;
	#currentSlideId: string | null = null;
	#disposed = false;

	constructor(opts: SlideshowFrameDriverOptions) {
		this.#getConfig = opts.getConfig;
		this.#getSlides = opts.getSlides;
		this.#baseEffects = opts.baseEffects;
		this.#getMoshOptions = opts.getMoshOptions;
		this.#getRenderer = opts.getRenderer;
		this.#sources = opts.sources;
		this.#waitForFrames = opts.waitForFrames ?? true;
		this.#smoothState = { effects: cloneEffects(opts.baseEffects) };
		this.#effects = cloneEffects(opts.baseEffects);
	}

	/**
	 * Resolve the frame at `time` (seconds on the beat timeline). A video slide
	 * is shown at the moment `time` picks out of its clip, so the same song
	 * position always yields the same frame.
	 */
	advance(time: number): SlideshowFrame {
		const config = this.#getConfig();
		const slides = this.#getSlides();
		const { index: beatIndex } = beatAtTime(
			Math.max(0, time),
			config.bpm,
			config.beatOffset,
			config.segments,
			config.subdivision,
		);

		// Stopped (subdivision 0): hold the current slide and effects.
		if (beatIndex === HOLD_BEAT || slides.length === 0) {
			return { effects: this.#effects, ready: null };
		}

		const slideIndex = config.loop
			? beatIndex % slides.length
			: Math.min(beatIndex, slides.length - 1);
		const slide = slides[slideIndex];
		if (!slide) return { effects: this.#effects, ready: null };

		if (beatIndex !== this.#lastBeatIndex) {
			this.#lastBeatIndex = beatIndex;
			if (slide.kind === "image" && slide.id !== this.#currentSlideId) {
				const img = this.#sources.getImage(slide);
				// A slide still decoding keeps the previous texture and retries next
				// beat (currentSlideId only advances once the upload happened).
				if (img) {
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
			ready = this.#advanceVideo(slide, time);
			this.#currentSlideId = slide.id;
		}

		return { effects: this.#effects, ready };
	}

	/** Stop late video uploads from landing after playback ends. */
	dispose() {
		this.#disposed = true;
	}

	#advanceVideo(slide: SlideshowSlide, time: number): Promise<void> | null {
		const sampler = this.#sources.getSampler(slide);
		if (!sampler) return null;
		// The clip runs against the song, not its own appearances: a slide that
		// comes back shows where the track has got to.
		return sampler.at(time, this.#waitForFrames).then((frame) => {
			if (!frame) return;
			if (!this.#disposed) this.#getRenderer().updateSourceFrame(frame);
			frame.close();
		});
	}

	#resolvePresets(): Preset[] {
		if (!this.#presets) this.#presets = loadPresets();
		return this.#presets;
	}
}
