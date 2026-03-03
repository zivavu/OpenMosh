import type { MoshOptions } from '../editor/mosh';
import type { EffectInstance } from '../effects';
import type { GlRenderer } from '../gl/renderer';
import type { RecordFormat } from '../recorder';
import { downloadBlob, recordVideo } from '../recorder';
import { beatAtTime } from './beat-clock';
import { cloneEffects, computeEffectsForBeat } from './sequencer';
import type { SlideshowConfig, SlideshowSlide, TransitionType } from './types';

export interface SlideshowRecordContext {
	format: RecordFormat;
	fps: number;
	slides: SlideshowSlide[];
	config: SlideshowConfig;
	baseEffects: EffectInstance[];
	audioFile: File;
	audioStart: number;
	audioEnd: number;
	canvas: HTMLCanvasElement;
	renderer: GlRenderer;
	moshOptions: MoshOptions;
	onProgress: (p: number) => void;
	onFinalizing: () => void;
	signal: AbortSignal;
}

export async function executeSlideshowRecording(
	ctx: SlideshowRecordContext,
): Promise<void> {
	const {
		format,
		fps,
		slides,
		config,
		baseEffects,
		audioFile,
		audioStart,
		audioEnd,
		canvas,
		renderer,
		moshOptions,
		onProgress,
		onFinalizing,
		signal,
	} = ctx;

	const duration = audioEnd - audioStart;
	const smoothState = { effects: cloneEffects(baseEffects) };

	// Pre-load all images
	const imageMap = new Map<string, HTMLImageElement>();
	await Promise.all(
		slides.map(
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
	);

	// Load the first image into the renderer to set up dimensions
	const firstImg = imageMap.get(slides[0].id);
	if (firstImg) {
		renderer.loadImage(firstImg);
	}

	let currentSlideId: string | null = null;
	let lastBeatIndex = -1;
	let currentEffects: EffectInstance[] = cloneEffects(baseEffects);
	const effectsRef = { current: currentEffects };

	// Transition state
	let activeTransition: TransitionType | null = null;
	let previousSlideImg: HTMLImageElement | null = null;

	function pickRandomTransition(): TransitionType | null {
		const enabled = config.enabledTransitions;
		if (!enabled || enabled.length === 0) return null;
		return enabled[Math.floor(Math.random() * enabled.length)];
	}

	const blob = await recordVideo({
		format,
		duration,
		fps: format === 'gif' ? Math.min(fps, 15) : fps,
		canvas,
		renderer,
		effects: baseEffects,
		effectsRef,
		onProgress,
		onFinalizing,
		signal,
		audioFile,
		audioStart,
		audioEnd,
		onBeforeRender(frameIndex: number, time: number) {
			const { index: beatIndex, fraction } = beatAtTime(
				time,
				config.bpm,
				config.beatOffset,
				config.segments,
				config.manualSwitchPoints,
				config.subdivision,
			);
			const slideIndex = config.loop
				? beatIndex % slides.length
				: Math.min(beatIndex, slides.length - 1);
			const slide = slides[slideIndex];

			if (beatIndex !== lastBeatIndex) {
				lastBeatIndex = beatIndex;

				// Save previous image for transition
				if (currentSlideId) {
					previousSlideImg = imageMap.get(currentSlideId) ?? null;
				}

				// Switch source texture when slide changes
				if (slide.id !== currentSlideId) {
					const img = imageMap.get(slide.id);
					if (img) {
						renderer.updateSourceImage(img);
						currentSlideId = slide.id;

						// Set up transition
						activeTransition = pickRandomTransition();
						if (activeTransition && previousSlideImg) {
							renderer.setTransitionImage(previousSlideImg);
						}
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

			// Handle transition rendering
			const transitionDuration = config.transitionDuration ?? 0.3;
			if (activeTransition && previousSlideImg && transitionDuration > 0) {
				const progress = Math.min(1, fraction / transitionDuration);
				if (progress < 1) {
					renderer.renderWithTransition(
						effectsRef.current,
						time,
						activeTransition,
						progress,
					);
					return true; // skip normal render in recordVideo
				} else {
					renderer.clearTransitionImage();
					activeTransition = null;
					previousSlideImg = null;
				}
			}
		},
	});

	downloadBlob(blob, format);
}
