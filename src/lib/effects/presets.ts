import type { EffectInstance, Preset } from "./types";
import { generateId } from "./types";
import { EFFECT_DEFINITIONS } from "./definitions";
import { STARTER_PRESETS } from "./starter-presets";
import { hueToHex } from "../color";

const PRESETS_KEY = "openmosh-presets";
/** Set once the starter presets have been written, so deleting them sticks. */
const SEEDED_KEY = "openmosh-presets-seeded";

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw !== null) return JSON.parse(raw);
    // First run: seed the starters as ordinary, editable user presets. Guarded
    // by its own key so a user who deletes them all doesn't get them back.
    if (localStorage.getItem(SEEDED_KEY) === null) {
      localStorage.setItem(SEEDED_KEY, "1");
      localStorage.setItem(PRESETS_KEY, JSON.stringify(STARTER_PRESETS));
      return JSON.parse(JSON.stringify(STARTER_PRESETS)) as Preset[];
    }
  } catch {}
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
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function updatePreset(index: number, effects: EffectInstance[]): Preset[] {
  const presets = loadPresets();
  presets[index].effects = serializeEffects(effects);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function deletePreset(index: number): Preset[] {
  const presets = loadPresets();
  presets.splice(index, 1);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

/**
 * Duotone's two hue sliders became color pickers. Presets saved before that
 * carry hues only — rebuild the colors the old shader would have produced
 * (shadows were the hue at 30% brightness) so they still look the same.
 */
function migrateValues(
  defId: string,
  values: Record<string, number | string>,
): Record<string, number | string> {
  if (defId !== "duotone") return values;
  const migrated = { ...values };
  if (typeof values.shadowHue === "number" && values.shadowColor == null) {
    migrated.shadowColor = hueToHex(values.shadowHue, 0.3);
  }
  if (typeof values.highlightHue === "number" && values.highlightColor == null) {
    migrated.highlightColor = hueToHex(values.highlightHue);
  }
  return migrated;
}

export function applyPreset(preset: Preset): EffectInstance[] {
  return preset.effects.map((pe) => {
    // Merge definition defaults under saved values so presets saved before a
    // param existed still get a sane value for it.
    const def = EFFECT_DEFINITIONS.find((d) => d.id === pe.defId);
    const defaults = def
      ? Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue]))
      : {};
    return {
      instanceId: generateId(),
      defId: pe.defId,
      enabled: pe.enabled,
      locked: false,
      expanded: false,
      values: { ...defaults, ...migrateValues(pe.defId, pe.values) },
      ...(pe.volumeLinks && { volumeLinks: { ...pe.volumeLinks } }),
    };
  });
}
