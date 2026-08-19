export * from "./types";
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

/** Lookup table, not a scan: this runs per linked effect on every rAF tick and
 * every export frame. */
const DEFINITIONS_BY_ID = new Map(EFFECT_DEFINITIONS.map((d) => [d.id, d]));

export function getDefinition(defId: string): EffectDefinition | undefined {
  return DEFINITIONS_BY_ID.get(defId);
}

export const HIDDEN_EFFECTS_KEY = "openmosh-hidden-effects";

export function loadInitialEffects(): EffectInstance[] {
  const hidden = readJson<string[] | null>(HIDDEN_EFFECTS_KEY, null);
  if (!Array.isArray(hidden)) return EFFECT_DEFINITIONS.map(createEffectInstance);
  const hiddenIds = new Set(hidden);
  return EFFECT_DEFINITIONS.filter((def) => !hiddenIds.has(def.id)).map(
    createEffectInstance,
  );
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
