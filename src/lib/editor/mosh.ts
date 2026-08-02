import { getDefinition, type EffectInstance, type VolumeLink } from "../effects";
import { shuffleInPlace } from "../utils";

export interface MoshOptions {
  moshMin: number;
  moshMax: number;
  randomizeOrder: boolean;
  moshAudioLink: boolean;
  /** 0–1: controls both how many params get linked and how wide their modulation range is. */
  moshAudioLinkStrength: number;
  hasAudio: boolean;
  /** When true, only currently enabled (non–hidden) effects are included in random mosh; disabled effects stay off. */
  onlyMoshEnabled?: boolean;
}

/**
 * Link a random share of range params to the music. Every link is full
 * spectrum — see the comment at the link site below.
 */
export function applyRandomAudioLinks(
  effects: EffectInstance[],
  hasAudio: boolean,
  strength: number = 0.8,
): void {
  if (!hasAudio || strength <= 0) {
    for (const effect of effects) {
      if (effect.volumeLinks) delete effect.volumeLinks;
    }
    return;
  }

  for (const effect of effects) {
    const def = getDefinition(effect.defId);
    if (!def) continue;

    if (!effect.enabled) {
      if (effect.volumeLinks) delete effect.volumeLinks;
      continue;
    }

    const links: Record<string, VolumeLink> = {};

    for (const param of def.params) {
      if (param.type !== "range") continue;

      // Probability scales with strength: at 1.0 all params linked, at 0.0 none
      if (Math.random() > strength) continue;

      const pMin = param.moshMin ?? param.min;
      const pMax = param.moshMax ?? param.max;
      const span = pMax - pMin;
      // Center position is independent of width so they don't limit each other
      const centerT = Math.random();
      // Width is guaranteed [50%–100%] of span at strength=1, scaled down linearly
      const widthFraction = strength * (0.5 + Math.random() * 0.5);
      const halfW = widthFraction / 2;
      let vMin = pMin + Math.max(0, centerT - halfW) * span;
      let vMax = pMin + Math.min(1, centerT + halfW) * span;

      if (param.step > 0) {
        const snap = (v: number) =>
          Math.round((v - pMin) / param.step) * param.step + pMin;
        vMin = snap(vMin);
        vMax = snap(vMax);
        if (vMax <= vMin) vMax = Math.min(pMax, vMin + param.step);
      }

      // Full spectrum: leaving freqMin/freqMax unset makes the link follow the
      // overall RMS level. Rolling a random band per param used to be the
      // default, but it reads as noise — half the links would sit on a quiet
      // part of the mix and barely move. Per-band links stay available by hand
      // via the Freq row on any linked param.
      links[param.key] = { min: vMin, max: vMax };
    }

    if (Object.keys(links).length > 0) {
      effect.volumeLinks = links;
    } else if (effect.volumeLinks) {
      delete effect.volumeLinks;
    }
  }
}

/**
 * Randomize effects — enable a random subset, randomize their params, optionally shuffle order.
 * Mutates the effects array in place.
 *
 * MUST stay fully synchronous and draw all randomness from `Math.random`:
 * sequence/preview determinism runs it inside `withSeededRandom`, which swaps
 * the global `Math.random` for the call's duration and restores it in a
 * `finally`. Introducing an `await` here (or a non-`Math.random` RNG) would let
 * the swap leak across the microtask boundary or bypass the seed — breaking the
 * preview/export "same seed → same mosh" guarantee. See [[sequence.ts]].
 */
export function generateMosh(
  effects: EffectInstance[],
  options: MoshOptions,
): void {
  const {
    moshMin,
    moshMax,
    randomizeOrder,
    moshAudioLink,
    moshAudioLinkStrength,
    onlyMoshEnabled,
  } = options;
  const moshable = effects.filter(
    (e) => !e.locked && (!onlyMoshEnabled || e.enabled),
  );
  const clampedMin = Math.min(moshMin, moshable.length);
  const clampedMax = Math.min(moshMax, moshable.length);
  const target =
    clampedMin + Math.floor(Math.random() * (clampedMax - clampedMin + 1));

  const indices = shuffleInPlace(moshable.map((_, i) => i));
  const enabledSet = new Set(indices.slice(0, target));

  moshable.forEach((effect, i) => {
    effect.enabled = enabledSet.has(i);
    if (!effect.enabled) return;
    const def = getDefinition(effect.defId);
    if (!def) return;
    for (const param of def.params) {
      if (param.type === "range") {
        const lo = param.moshMin ?? param.min;
        const hi = param.moshMax ?? param.max;
        const range = hi - lo;
        const bias = 0.15 + Math.random() * 0.55;
        effect.values[param.key] =
          Math.round((lo + bias * range) / param.step) * param.step;
      } else if (param.type === "select") {
        const opts = param.options;
        effect.values[param.key] =
          opts[Math.floor(Math.random() * opts.length)].value;
      }
    }
  });

  if (randomizeOrder) {
    const moshableIndices = effects
      .map((e, i) => (e.locked ? -1 : i))
      .filter((i) => i !== -1);
    const shuffled = shuffleInPlace([...moshableIndices]);
    const snapshot = effects.map((e) => ({ ...e }));
    for (let k = 0; k < moshableIndices.length; k++) {
      effects[moshableIndices[k]] = snapshot[shuffled[k]];
    }
  }

  if (moshAudioLink) {
    applyRandomAudioLinks(effects, options.hasAudio, moshAudioLinkStrength);
  } else {
    for (const effect of effects) {
      if (effect.volumeLinks) delete effect.volumeLinks;
    }
  }
}

export function clearEffects(effects: EffectInstance[]): void {
  for (const effect of effects) {
    effect.enabled = false;
    const def = getDefinition(effect.defId);
    if (!def) continue;
    for (const param of def.params) {
      effect.values[param.key] = param.defaultValue;
    }
  }
}
