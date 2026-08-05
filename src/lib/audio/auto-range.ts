/**
 * Rolling per-band normalization: reports where a level sits within the band's
 * recent dynamic range, not its absolute loudness.
 *
 * Band levels are dB-scaled FFT means, so limited music (hardstyle, most modern
 * EDM) moves only ~0.15 between break and drop and no fixed curve can serve both
 * that and material with real dynamics. Measuring against a rolling window makes
 * a drop read as a drop at any mastering level.
 *
 * Decay is expressed in seconds and converted with the frame delta, so a 60 fps
 * preview and a 30 fps export converge on the same envelope — otherwise renders
 * would not match what was previewed.
 */

/** Default blend of raw (0) vs auto-ranged (1) level, when no setting is stored. */
export const DEFAULT_AUTO_RANGE_AMOUNT = 0.5;

const CEIL_DECAY_TAU = 2.5;
/** Slower than the ceiling so a loud passage doesn't erase its own headroom. */
const FLOOR_RISE_TAU = 4;
/** Below this the band is steady and the gain would just amplify noise. */
const MIN_SPAN = 0.06;

interface BandEnvelope {
  floor: number;
  ceil: number;
}

const envelopes = new Map<string, BandEnvelope>();

/** Call on any signal discontinuity: seek, track change, export start. */
export function resetAutoRange(): void {
  envelopes.clear();
}

/** Position of `level` in the band's recent range, in [0, 1]. */
export function autoRangeLevel(key: string, level: number, dt: number): number {
  let env = envelopes.get(key);
  if (!env) {
    // Seeded around the first sample so playback starts mid-scale, not at 0.
    env = { floor: level - MIN_SPAN / 2, ceil: level + MIN_SPAN / 2 };
    envelopes.set(key, env);
  }

  // A stalled clock would otherwise collapse the envelope in a single step.
  const step = Math.max(0, Math.min(dt, 0.25));

  // Asymmetric: jump to new extremes, drift back slowly.
  if (level > env.ceil) env.ceil = level;
  else env.ceil += (level - env.ceil) * (1 - Math.exp(-step / CEIL_DECAY_TAU));

  if (level < env.floor) env.floor = level;
  else env.floor += (level - env.floor) * (1 - Math.exp(-step / FLOOR_RISE_TAU));

  const span = env.ceil - env.floor;
  if (span < MIN_SPAN) return 0;
  return Math.max(0, Math.min(1, (level - env.floor) / span));
}
