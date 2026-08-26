import { FREQ_PRESETS, getDefinition, type EffectInstance } from "../effects";
import {
  autoRangeLevel,
  punchExponent,
  smoothBandLevel,
  type AudioResponse,
} from "./auto-range";

function bandKey(scope: string, freqMin: number, freqMax: number): string {
  return `${scope}|${freqMin}:${freqMax}`;
}

/** Scratch for applyVolumeLinksToEffects; valid only within one call. */
const perBand = new Map<string, number>();

/**
 * A set of effects that follows the music its own way. Every chain used to
 * share one response; an fx lane now carries its own, and the envelope state
 * behind a band is per scope so one lane's smoothing never steps another's.
 */
export interface AudioLinkGroup {
  /** Namespaces the per-band envelope state. Lanes pass their lane id. */
  scope: string;
  effects: EffectInstance[];
  response: AudioResponse;
}

const NO_GROUPS: AudioLinkGroup[] = [];

/**
 * One group per layer lane — media layers and text layers alike, so a layer's
 * own chain follows the music the way the main chain and the fx lanes do.
 *
 * Built from the lanes rather than from the layers resolved for a frame: a
 * lane's chain is fixed for the whole lane, not per clip, so this way preview
 * and export advance the very same envelopes whether or not a lane happens to
 * have a clip under the playhead. Resolving per frame instead would let a
 * lane's auto-range drift between the two across every gap in it.
 */
export function layerLinkGroups(
  lanes: readonly { id: string; effects: EffectInstance[] }[],
  response: AudioResponse,
): AudioLinkGroup[] {
  if (lanes.length === 0) return NO_GROUPS;
  // The lane id is the scope, the same way an fx lane's is: one lane's
  // smoothing must never step another's.
  return lanes.map((lane) => ({
    scope: lane.id,
    effects: lane.effects,
    response,
  }));
}

/**
 * `dt` and `response` must match between preview and export, or a render will
 * not look like what was previewed.
 */
export function applyVolumeLinksToEffects(
  effects: EffectInstance[],
  volumeLevel: number,
  frequencyData: Uint8Array | null,
  sampleRate: number,
  fftSize: number,
  dt: number,
  response: AudioResponse,
  scope: string = "",
): void {
  const exponent = punchExponent(response.punch);
  // Cached so a band's envelope advances once per frame, not once per link.
  // Reused across calls rather than minted per frame: this runs every rAF tick
  // for every link group, and nothing reads it after the call returns.
  perBand.clear();
  const levelForBand = (freqMin: number, freqMax: number): number => {
    const key = bandKey(scope, freqMin, freqMax);
    const cached = perBand.get(key);
    if (cached !== undefined) return cached;
    const measured =
      frequencyData && sampleRate > 0
        ? getLevelFromFrequencyRange(
            frequencyData,
            sampleRate,
            fftSize,
            freqMin,
            freqMax,
          )
        : volumeLevel;
    // Smoothed before ranging, not after: the envelope has to see the same
    // steadied signal in an export that the preview's analyser handed it, or
    // its ceiling gets pinned by transients the preview never showed it.
    const raw = smoothBandLevel(key, measured, dt, response.smoothing);
    const ranged = autoRangeLevel(key, raw, dt);
    perBand.set(key, ranged);
    return ranged;
  };

  for (const effect of effects) {
    const links = effect.volumeLinks;
    if (!links) continue;
    const def = getDefinition(effect.defId);
    if (!def) continue;
    for (const param of def.params) {
      if (param.type !== "range") continue;
      const link = links[param.key];
      if (!link) continue;
      let level = levelForBand(
        link.freqMin ?? FREQ_PRESETS.full.min,
        link.freqMax ?? FREQ_PRESETS.full.max,
      );
      // Shape before inverting, so inverted is the mirror of the same response.
      level = level ** exponent;
      if (link.inverted) level = 1 - level;
      const { min: pMin, max: pMax, step } = param;
      let value = link.min + level * (link.max - link.min);
      value = Math.max(pMin, Math.min(pMax, value));
      if (step > 0) {
        value = Math.round((value - pMin) / step) * step + pMin;
        value = Math.max(pMin, Math.min(pMax, value));
      }
      effect.values[param.key] = value;
    }
  }
}

export function getLevelFromFrequencyRange(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  freqMin: number,
  freqMax: number,
): number {
  const binCount = freqData.length;
  const minBin = Math.max(0, Math.floor((freqMin / sampleRate) * fftSize));
  const maxBin = Math.min(
    binCount - 1,
    Math.ceil((freqMax / sampleRate) * fftSize),
  );
  if (minBin > maxBin) return 0;
  let sum = 0;
  for (let i = minBin; i <= maxBin; i++) sum += freqData[i];
  const count = maxBin - minBin + 1;
  return Math.min(1, sum / count / 255);
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** m:ss.mmm — for the playhead readout, where a frame is ~16ms. */
export function formatTimeMs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.000";
  const ms = Math.floor((sec % 1) * 1000);
  return `${formatTime(sec)}.${ms.toString().padStart(3, "0")}`;
}
