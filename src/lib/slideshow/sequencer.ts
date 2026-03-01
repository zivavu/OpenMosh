import type { SlideshowSlide, SlideshowConfig } from './types';
import type { EffectInstance, RangeParam } from '../effects';
import { createBeatClock } from './beat-clock';
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
 * Smooth modulation: pick one enabled effect, pick one range param,
 * nudge it by ±10–30% of its range. Returns a new effects array.
 */
export function nudgeOneParam(effects: EffectInstance[]): EffectInstance[] {
	const enabled = effects.filter((e) => e.enabled);
	if (enabled.length === 0) return effects;

	const target = enabled[Math.floor(Math.random() * enabled.length)];
	const def = getDefinition(target.defId);
	if (!def) return effects;

	const rangeParams = def.params.filter(
		(p): p is RangeParam => p.type === 'range',
	);
	if (rangeParams.length === 0) return effects;

	const param = rangeParams[Math.floor(Math.random() * rangeParams.length)];
	const current = target.values[param.key] as number;
	const lo = param.moshMin ?? param.min;
	const hi = param.moshMax ?? param.max;
	const nudge =
		(hi - lo) *
		(0.1 + Math.random() * 0.2) *
		(Math.random() < 0.5 ? 1 : -1);
	const next = Math.max(lo, Math.min(hi, current + nudge));
	const snapped =
		param.step > 0
			? Math.round((next - param.min) / param.step) * param.step + param.min
			: next;

	return effects.map((e) =>
		e.instanceId === target.instanceId
			? { ...e, values: { ...e.values, [param.key]: snapped } }
			: e,
	);
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
			smoothState.effects = nudgeOneParam(smoothState.effects);
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
	const clock = createBeatClock(config.bpm, config.subdivision, config.beatOffset);
	const totalBeats = Math.ceil(durationSeconds / clock.intervalSeconds);
	const frames: ResolvedFrame[] = [];
	const smoothState = { effects: cloneEffects(baseEffects) };

	for (let i = 0; i < totalBeats; i++) {
		const slideIndex = config.loop
			? i % slides.length
			: Math.min(i, slides.length - 1);
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

	return { frames, totalDuration: durationSeconds };
}
