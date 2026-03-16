export * from "./types";
export { EFFECT_DEFINITIONS } from "./definitions";
export { loadPresets, savePreset, updatePreset, deletePreset, applyPreset } from "./presets";

import type { EffectDefinition, EffectInstance, VolumeLink } from "./types";
import { generateId } from "./types";
import { EFFECT_DEFINITIONS } from "./definitions";

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

export function getDefinition(defId: string): EffectDefinition | undefined {
  return EFFECT_DEFINITIONS.find((d) => d.id === defId);
}

export const HIDDEN_EFFECTS_KEY = "openmosh-hidden-effects";

export function loadInitialEffects(): EffectInstance[] {
  try {
    const raw = localStorage.getItem(HIDDEN_EFFECTS_KEY);
    if (raw) {
      const hiddenIds = new Set<string>(JSON.parse(raw));
      return EFFECT_DEFINITIONS.filter((def) => !hiddenIds.has(def.id)).map(
        createEffectInstance,
      );
    }
  } catch {}
  return EFFECT_DEFINITIONS.map(createEffectInstance);
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
