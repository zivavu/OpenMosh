import {
	applyRandomAudioLinks,
	generateMosh,
	isRollable,
	type MoshStyle,
	randomizeParams,
	type MoshOptions,
} from "../editor/mosh";
import type { EffectInstance } from "../effects";
import { getDefinition } from "../effects";
import type { SlideshowConfig } from "./types";

/**
 * Deep-clone an effects array for a beat, keeping each instance's ID: the
 * renderer keys per-instance state (feedback buffers, phase, tracking) on it.
 */
export function cloneEffects(effects: EffectInstance[]): EffectInstance[] {
	return effects.map((e) => ({ ...e, values: { ...e.values } }));
}

/**
 * Smooth mode: toggle one non-locked effect, biased toward enabling below
 * moshMin and disabling above moshMax.
 */
function toggleOneEffect(
	effects: EffectInstance[],
	moshMin: number,
	moshMax: number,
	style: MoshStyle | undefined,
): EffectInstance[] {
	const moshableEnabled: number[] = [];
	const moshableDisabled: number[] = [];
	for (let i = 0; i < effects.length; i++) {
		const e = effects[i];
		if (!isRollable(e, style)) continue;
		(e.enabled ? moshableEnabled : moshableDisabled).push(i);
	}

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

		const def = getDefinition(toggled.defId);
		if (!def) return toggled;
		const values = { ...toggled.values };
		randomizeParams(values, def);
		return { ...toggled, values };
	});
}

/**
 * Effects for a single beat by mosh mode. Mutates `smoothState` in place for
 * 'smooth'.
 */
export function computeEffectsForBeat(
	config: SlideshowConfig,
	baseEffects: EffectInstance[],
	smoothState: { effects: EffectInstance[] },
	moshOptions: MoshOptions,
): EffectInstance[] {
	switch (config.moshMode) {
		case "random": {
			const effects = cloneEffects(baseEffects);
			generateMosh(effects, moshOptions);
			return effects;
		}
		case "consistent":
			return cloneEffects(baseEffects);
		case "smooth": {
			const steps = Math.max(1, Math.round(config.smoothSpeed ?? 1));
			for (let i = 0; i < steps; i++) {
				smoothState.effects = toggleOneEffect(
					smoothState.effects,
					moshOptions.moshMin,
					moshOptions.moshMax,
					moshOptions.moshStyle,
				);
			}
			return withRandomAudioLinks(
				cloneEffects(smoothState.effects),
				moshOptions,
			);
		}
	}
}

/**
 * Re-roll random audio links for the beat when the toggle is on; `generateMosh`
 * covers `random` mode, this covers `smooth`.
 */
function withRandomAudioLinks(
	effects: EffectInstance[],
	moshOptions: MoshOptions,
): EffectInstance[] {
	if (moshOptions.moshAudioLink) {
		applyRandomAudioLinks(
			effects,
			moshOptions.hasAudio,
			moshOptions.moshAudioLinkStrength,
			moshOptions.moshLinkBand,
		);
	}
	return effects;
}
