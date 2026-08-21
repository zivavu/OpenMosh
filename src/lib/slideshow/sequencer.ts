import {
  applyRandomAudioLinks,
  generateMosh,
  isMoshable,
  randomizeParams,
  type MoshOptions,
} from "../editor/mosh";
import type { EffectInstance, Preset } from "../effects";
import { applyPreset, getDefinition, loadPresets } from "../effects";
import type { SlideshowConfig, SlideshowSlide } from "./types";

/**
 * Deep-clone an effects array for a beat, keeping each instance's ID.
 *
 * The IDs are what the renderer keys its per-instance state on — feedback
 * buffer pairs, accumulated phase, tracking boxes, caption textures. Minting
 * fresh ones every beat made it allocate and then garbage-collect a pair of
 * full-resolution render targets per feedback effect per beat, which at 1/16
 * and 1/32 is several a second.
 */
export function cloneEffects(effects: EffectInstance[]): EffectInstance[] {
  return effects.map((e) => ({ ...e, values: { ...e.values } }));
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
    if (!isMoshable(e)) continue;
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
    randomizeParams(values, def);
    return { ...toggled, values };
  });
}

/**
 * Compute the effects for a single beat based on the mosh mode.
 * For 'smooth' mode, mutates `smoothState` in place (pass a ref object).
 * `presets` (used by 'per-image') should be supplied by callers that run this
 * per beat, so a localStorage read + parse doesn't land on every frame.
 */
export function computeEffectsForBeat(
  config: SlideshowConfig,
  slide: SlideshowSlide,
  baseEffects: EffectInstance[],
  smoothState: { effects: EffectInstance[] },
  moshOptions: MoshOptions,
  presets?: Preset[],
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
        const preset = (presets ?? loadPresets())[slide.presetIndex];
        // Derived from the slide, not minted: a slide coming back round reuses
        // the renderer state its chain built last time instead of forcing a
        // fresh set of feedback buffers.
        if (preset) {
          return applyPreset(preset).map((e, i) => ({
            ...e,
            instanceId: `${slide.id}:${i}`,
          }));
        }
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
      moshOptions.moshAudioLinkStrength,
      moshOptions.moshLinkBand,
    );
  }
  return effects;
}
