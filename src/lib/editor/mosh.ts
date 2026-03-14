import {
  FREQ_PRESETS,
  getDefinition,
  type EffectInstance,
  type VolumeLink,
} from "../effects";
import { shuffleInPlace } from "../utils";

export interface MoshOptions {
  moshMin: number;
  moshMax: number;
  randomizeOrder: boolean;
  moshAudioLink: boolean;
  /** 0–1: controls both how many params get linked and how wide their modulation range is. */
  moshAudioLinkStrength: number;
  hasAudio: boolean;
  audioSampleRate: number;
  frequencyData: Uint8Array | null;
  /** When true, only currently enabled (non–hidden) effects are included in random mosh; disabled effects stay off. */
  onlyMoshEnabled?: boolean;
}

export function applyRandomAudioLinks(
  effects: EffectInstance[],
  hasAudio: boolean,
  audioSampleRate: number,
  frequencyData: Uint8Array | null,
  strength: number = 0.8,
): void {
  if (!hasAudio || strength <= 0) {
    for (const effect of effects) {
      if (effect.volumeLinks) delete effect.volumeLinks;
    }
    return;
  }

  const nyquist = audioSampleRate > 0 ? audioSampleRate / 2 : 22050;

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

      const pMin = param.min;
      const pMax = param.max;
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

      let freqMin: number | undefined;
      let freqMax: number | undefined;

      const mode = Math.random();
      if (mode < 0.2 || !frequencyData || audioSampleRate <= 0) {
        // Full spectrum
      } else if (mode < 0.4) {
        freqMin = FREQ_PRESETS.low.min;
        freqMax = FREQ_PRESETS.low.max;
      } else if (mode < 0.7) {
        freqMin = FREQ_PRESETS.mid.min;
        freqMax = FREQ_PRESETS.mid.max;
      } else if (mode < 0.9) {
        freqMin = FREQ_PRESETS.high.min;
        freqMax = FREQ_PRESETS.high.max;
      } else {
        // Custom random band
        const f1 = 20 + Math.random() * (nyquist - 20);
        const f2 = 20 + Math.random() * (nyquist - 20);
        freqMin = Math.min(f1, f2);
        freqMax = Math.max(f1, f2);
      }

      const link: VolumeLink = { min: vMin, max: vMax };
      if (freqMin != null && freqMax != null) {
        link.freqMin = freqMin;
        link.freqMax = freqMax;
      }

      links[param.key] = link;
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
    applyRandomAudioLinks(
      effects,
      options.hasAudio,
      options.audioSampleRate,
      options.frequencyData,
      moshAudioLinkStrength,
    );
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
