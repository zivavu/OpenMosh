import type { SlideshowSlide, SlideshowConfig } from './types';
import type { EffectInstance } from '../effects';
import { beatAtTime } from './beat-clock';
import { generateMosh, type MoshOptions } from '../editor/mosh';
import {
	EFFECT_DEFINITIONS,
	getDefinition,
	applyPreset,
	loadPresets,
} from '../effects';

export interface ResolvedFrame {
	slide: SlideshowSlide;
	effects: EffectInstance[];
}

export interface SequencerState {
	frames: ResolvedFrame[];
	totalDuration: number;
}

/** Deep-clone an effects array, giving each instance a fresh ID. */
export function cloneEffects(effects: EffectInstance[]): EffectInstance[] {
	return effects.map((e) => ({
		...e,
		instanceId: crypto.randomUUID(),
		values: { ...e.values },
		volumeLinks: e.volumeLinks ? { ...e.volumeLinks } : undefined,
	}));
}

/**
 * Smooth mode: toggle exactly one non-locked effect on or off.
 * Biased toward enabling when below moshMin and disabling when above moshMax.
 */
export function toggleOneEffect(
	effects: EffectInstance[],
	moshMin: number,
	moshMax: number,
): EffectInstance[] {
	const moshableEnabled = effects.reduce<number[]>(
		(acc, e, i) => (!e.locked && e.enabled ? [...acc, i] : acc),
		[],
	);
	const moshableDisabled = effects.reduce<number[]>(
		(acc, e, i) => (!e.locked && !e.enabled ? [...acc, i] : acc),
		[],
	);

	const count = moshableEnabled.length;
	let shouldEnable: boolean;
	if (count <= moshMin || moshableDisabled.length === 0) {
		shouldEnable = true;
	} else if (count >= moshMax || moshableEnabled.length === 0) {
		shouldEnable = false;
	} else {
		shouldEnable = Math.random() < 0.5;
	}

	const candidates = shouldEnable ? moshableDisabled : moshableEnabled;
	if (candidates.length === 0) return effects;

	const pick = candidates[Math.floor(Math.random() * candidates.length)];
	return effects.map((e, i) => {
		if (i !== pick) return e;
		const toggled = { ...e, enabled: !e.enabled };
		if (!toggled.enabled) return toggled;

		// Randomize params when enabling
		const def = getDefinition(toggled.defId);
		if (!def) return toggled;
		const values = { ...toggled.values };
		for (const param of def.params) {
			if (param.type === 'range') {
				const lo = param.moshMin ?? param.min;
				const hi = param.moshMax ?? param.max;
				const bias = 0.15 + Math.random() * 0.55;
				const raw = lo + bias * (hi - lo);
				values[param.key] =
					param.step > 0
						? Math.round((raw - param.min) / param.step) * param.step + param.min
						: raw;
			} else if (param.type === 'select') {
				const opts = param.options;
				values[param.key] = opts[Math.floor(Math.random() * opts.length)].value;
			}
		}
		return { ...toggled, values };
	});
}

/**
 * Compute the effects for a single beat based on the mosh mode.
 * For 'smooth' mode, mutates `smoothState` in place (pass a ref object).
 */
export function computeEffectsForBeat(
	config: SlideshowConfig,
	slide: SlideshowSlide,
	baseEffects: EffectInstance[],
	smoothState: { effects: EffectInstance[] },
	moshOptions: MoshOptions,
): EffectInstance[] {
	switch (config.moshMode) {
		case 'random': {
			const effects = cloneEffects(baseEffects);
			generateMosh(effects, moshOptions);
			return effects;
		}
		case 'consistent':
			return cloneEffects(baseEffects);
		case 'smooth': {
			const steps = Math.max(1, Math.round(config.smoothSpeed ?? 1));
			for (let i = 0; i < steps; i++) {
				smoothState.effects = toggleOneEffect(
					smoothState.effects,
					moshOptions.moshMin,
					moshOptions.moshMax,
				);
			}
			return cloneEffects(smoothState.effects);
		}
		case 'per-image': {
			if (slide.presetIndex !== null) {
				const presets = loadPresets();
				const preset = presets[slide.presetIndex];
				if (preset) return applyPreset(preset);
			}
			return cloneEffects(baseEffects);
		}
	}
}

/**
 * Pre-compute all per-beat effect snapshots for the entire slideshow duration.
 * Used during recording for deterministic output.
 */
export function buildFrameSequence(
	slides: SlideshowSlide[],
	config: SlideshowConfig,
	baseEffects: EffectInstance[],
	moshOptions: MoshOptions,
	durationSeconds: number,
): SequencerState {
	const frames: ResolvedFrame[] = [];
	const smoothState = { effects: cloneEffects(baseEffects) };

	// Step through time, finding each beat boundary using beatAtTime
	let lastBeatIndex = -1;
	const dt = 0.001; // 1ms resolution for finding beat boundaries
	for (let t = 0; t < durationSeconds; t += dt) {
		const { index: beatIndex } = beatAtTime(
			t,
			config.bpm,
			config.beatOffset,
			config.segments,
			config.manualSwitchPoints,
			config.subdivision,
		);
		if (beatIndex !== lastBeatIndex) {
			lastBeatIndex = beatIndex;
			const slideIndex = config.loop
				? frames.length % slides.length
				: Math.min(frames.length, slides.length - 1);
			const slide = slides[slideIndex];
			const effects = computeEffectsForBeat(
				config,
				slide,
				baseEffects,
				smoothState,
				moshOptions,
			);
			frames.push({ slide, effects });
		}
	}

	return { frames, totalDuration: durationSeconds };
}
