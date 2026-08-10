/**
 * Per-band temporal state: the smoothing that steadies a band level, and the
 * rolling normalization that reports where it sits within the band's recent
 * dynamic range rather than its absolute loudness. Both are keyed by band and
 * both are cleared together on a discontinuity.
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
export const DEFAULT_AUTO_RANGE_AMOUNT = 0.75;

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
const smoothed = new Map<string, number>();

/** Call on any signal discontinuity: seek, track change, export start. */
export function resetAutoRange(): void {
   envelopes.clear();
   smoothed.clear();
}

/**
 * Time constant of the band smoother. Chosen to match what the preview used to
 * get for free from AnalyserNode's default smoothingTimeConstant of 0.8:
 * τ = -1 / (60 · ln 0.8) ≈ 75 ms at 60 fps.
 */
const SMOOTH_TAU = 0.075;

/**
 * One-pole smoothing of a raw band level, stepped in seconds.
 *
 * The preview took this from the AnalyserNode, which the offline export has no
 * equivalent for — so a render fed auto-ranging raw, twitchy per-frame FFT
 * values while the preview fed it a smoothed curve. Since the ceiling below
 * snaps to any peak, those spikes pinned it and left the effect reading near
 * its floor for most frames: the render stopped tracking the beat the preview
 * rode. Doing it here, off the frame delta, is what makes the two agree — and
 * frees the preview from its dependence on the monitor's refresh rate.
 */
export function smoothBandLevel(
   key: string,
   level: number,
   dt: number,
): number {
   const prev = smoothed.get(key);
   if (prev === undefined) {
      smoothed.set(key, level);
      return level;
   }
   // A stalled clock would otherwise snap the smoother straight to the input.
   const step = Math.max(0, Math.min(dt, 0.25));
   const next = prev + (level - prev) * (1 - Math.exp(-step / SMOOTH_TAU));
   smoothed.set(key, next);
   return next;
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
