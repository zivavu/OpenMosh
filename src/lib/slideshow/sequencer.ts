import {
  applyRandomAudioLinks,
  generateMosh,
  type MoshOptions,
} from "../editor/mosh";
import type { EffectInstance } from "../effects";
import {
  applyPreset,
  cloneEffectInstance,
  getDefinition,
  loadPresets,
} from "../effects";
import type { SlideshowConfig, SlideshowSlide } from "./types";

/** Deep-clone an effects array, giving each instance a fresh ID. */
export function cloneEffects(effects: EffectInstance[]): EffectInstance[] {
  return effects.map(cloneEffectInstance);
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
  const moshableEnabled: number[] = [];
  const moshableDisabled: number[] = [];
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    if (e.locked) continue;
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

    // Randomize params when enabling
    const def = getDefinition(toggled.defId);
    if (!def) return toggled;
    const values = { ...toggled.values };
    for (const param of def.params) {
      if (param.type === "range") {
        const lo = param.moshMin ?? param.min;
        const hi = param.moshMax ?? param.max;
        const bias = 0.15 + Math.random() * 0.55;
        const raw = lo + bias * (hi - lo);
        values[param.key] =
          param.step > 0
            ? Math.round((raw - param.min) / param.step) * param.step +
              param.min
            : raw;
      } else if (param.type === "select") {
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
        );
      }
      return withRandomAudioLinks(cloneEffects(smoothState.effects), moshOptions);
    }
    case "per-image": {
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
 * Re-roll random audio links for the beat when the "Random audio links"
 * toggle is on. `generateMosh` already does this for `random` mode; this
 * covers `smooth`, which never calls it. Not applied to `consistent` or
 * `per-image` — those keep the user's manual/preset links.
 */
function withRandomAudioLinks(
  effects: EffectInstance[],
  moshOptions: MoshOptions,
): EffectInstance[] {
  if (moshOptions.moshAudioLink) {
    applyRandomAudioLinks(
      effects,
      moshOptions.hasAudio,
      moshOptions.audioSampleRate,
      moshOptions.frequencyData,
      moshOptions.moshAudioLinkStrength,
    );
  }
  return effects;
}
