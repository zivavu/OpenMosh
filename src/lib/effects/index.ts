export * from "./types";
export { getDefinition, hydrateValues, hydrateEffects } from "./hydrate";
export { EFFECT_DEFINITIONS } from "./definitions";
export {
	loadPresets,
	savePreset,
	updatePreset,
	deletePreset,
	applyPreset,
	normalizePresetName,
	PRESET_NAME_MAX_LENGTH,
} from "./presets";

import type { EffectDefinition, EffectInstance, VolumeLink } from "./types";
import { generateId } from "./types";
import { EFFECT_DEFINITIONS } from "./definitions";
import { hydrateEffects } from "./hydrate";
import { readJson } from "../storage";

export function createEffectInstance(def: EffectDefinition): EffectInstance {
	return {
		instanceId: generateId(),
		defId: def.id,
		enabled: false,
		locked: false,
		expanded: false,
		values: Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue])),
		volumeLinks: undefined,
	};
}

export function cloneEffectInstance(e: EffectInstance): EffectInstance {
	return {
		...e,
		instanceId: generateId(),
		values: { ...e.values },
		volumeLinks: e.volumeLinks ? { ...e.volumeLinks } : undefined,
	};
}

export const HIDDEN_EFFECTS_KEY = "openmosh-hidden-effects";

export function loadInitialEffects(): EffectInstance[] {
	const hidden = readJson<string[] | null>(HIDDEN_EFFECTS_KEY, null);
	if (!Array.isArray(hidden))
		return EFFECT_DEFINITIONS.map(createEffectInstance);
	const hiddenIds = new Set(hidden);
	return EFFECT_DEFINITIONS.filter((def) => !hiddenIds.has(def.id)).map(
		createEffectInstance,
	);
}

/**
 * Append a disabled instance for every effect the chain lacks, unless the user
 * hid it. A stored chain is only as long as the registry was the day it was
 * saved, so without this each new effect surfaces under "hidden" instead of
 * in the pool.
 */
export function addNewEffects(effects: EffectInstance[]): EffectInstance[] {
	const hidden = new Set(readJson<string[] | null>(HIDDEN_EFFECTS_KEY, null));
	const present = new Set(effects.map((e) => e.defId));
	const added = EFFECT_DEFINITIONS.filter(
		(def) => !present.has(def.id) && !hidden.has(def.id),
	).map(createEffectInstance);
	return added.length > 0 ? [...effects, ...added] : effects;
}

/** hydrateEffects, then the effects the chain predates. */
export function restoreEffects(saved: unknown): EffectInstance[] {
	return addNewEffects(hydrateEffects(saved));
}

export function setVolumeLink(
	effects: EffectInstance[],
	index: number,
	paramKey: string,
	link: VolumeLink | null,
): EffectInstance[] {
	const e = effects[index];
	const nextLinks = e.volumeLinks ? { ...e.volumeLinks } : {};
	if (link === null) {
		delete nextLinks[paramKey];
	} else {
		nextLinks[paramKey] = link;
	}
	return effects.map((eff, i) =>
		i === index ? { ...eff, volumeLinks: nextLinks } : eff,
	);
}
