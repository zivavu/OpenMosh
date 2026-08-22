import type { EffectInstance, Preset } from "./types";
import { generateId } from "./types";
import { hydrateValues } from "./hydrate";
import { STARTER_PRESETS } from "./starter-presets";
import { readJson, readRaw, writeJson, writeRaw } from "../storage";

const PRESETS_KEY = "openmosh-presets";
/** Set once the starter presets have been written, so deleting them sticks. */
const SEEDED_KEY = "openmosh-presets-seeded";

export function loadPresets(): Preset[] {
  const stored = readJson<Preset[] | null>(PRESETS_KEY, null);
  if (stored !== null) return stored;
  // First run: seed the starters as ordinary, editable user presets. Guarded
  // by its own key so a user who deletes them all doesn't get them back.
  if (readRaw(SEEDED_KEY) === null) {
    writeRaw(SEEDED_KEY, "1");
    writeJson(PRESETS_KEY, STARTER_PRESETS);
    return structuredClone(STARTER_PRESETS) as Preset[];
  }
  return [];
}

/** Names only ever render in narrow one-line rows. */
export const PRESET_NAME_MAX_LENGTH = 40;

export function normalizePresetName(name: string): string {
  return name.trim().slice(0, PRESET_NAME_MAX_LENGTH).trim();
}

/** What a preset keeps of a live chain: no instance ids, no UI state, and no
 * empty volumeLinks key to bloat every saved entry. */
function serializeEffects(effects: EffectInstance[]): Preset["effects"] {
  return effects.map((e) => ({
    defId: e.defId,
    enabled: e.enabled,
    values: { ...e.values },
    ...(e.volumeLinks &&
      Object.keys(e.volumeLinks).length > 0 && {
        volumeLinks: { ...e.volumeLinks },
      }),
  }));
}

export function savePreset(name: string, effects: EffectInstance[]): Preset[] {
  const presets = loadPresets();
  presets.push({
    name: normalizePresetName(name),
    effects: serializeEffects(effects),
  });
  writeJson(PRESETS_KEY, presets);
  return presets;
}

export function updatePreset(index: number, effects: EffectInstance[]): Preset[] {
  const presets = loadPresets();
  presets[index].effects = serializeEffects(effects);
  writeJson(PRESETS_KEY, presets);
  return presets;
}

export function deletePreset(index: number): Preset[] {
  const presets = loadPresets();
  presets.splice(index, 1);
  writeJson(PRESETS_KEY, presets);
  return presets;
}

export function applyPreset(preset: Preset): EffectInstance[] {
  return preset.effects.map((pe) => ({
    instanceId: generateId(),
    defId: pe.defId,
    enabled: pe.enabled,
    locked: false,
    expanded: false,
    // Definition defaults underneath, so a preset saved before a param existed
    // still gets a sane value for it.
    values: hydrateValues(pe.defId, pe.values),
    ...(pe.volumeLinks && { volumeLinks: { ...pe.volumeLinks } }),
  }));
}
