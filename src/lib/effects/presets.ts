import type { EffectInstance, Preset, VolumeLink } from "./types";

const PRESETS_KEY = "openmosh-presets";

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePreset(name: string, effects: EffectInstance[]): Preset[] {
  const presets = loadPresets();
  presets.push({
    name,
    effects: effects.map((e) => ({
      defId: e.defId,
      enabled: e.enabled,
      values: { ...e.values },
      ...(e.volumeLinks &&
        Object.keys(e.volumeLinks).length > 0 && {
          volumeLinks: { ...e.volumeLinks },
        }),
    })),
  });
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function deletePreset(index: number): Preset[] {
  const presets = loadPresets();
  presets.splice(index, 1);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function applyPreset(preset: Preset): EffectInstance[] {
  return preset.effects.map((pe) => ({
    instanceId: crypto.randomUUID(),
    defId: pe.defId,
    enabled: pe.enabled,
    locked: false,
    expanded: false,
    values: { ...pe.values },
    ...(pe.volumeLinks && { volumeLinks: { ...pe.volumeLinks } }),
  }));
}
