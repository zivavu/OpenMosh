/**
 * Per-band temporal state: the envelope follower that steadies a band level,
 * and the rolling normalization that reports where it sits within the band's
 * recent dynamic range rather than its absolute loudness. Both are keyed by
 * band and both are cleared together on a discontinuity.
 *
 * Band levels are dB-scaled FFT means, so limited music (hardstyle, most modern
 * EDM) moves only ~0.15 between break and drop and no fixed curve can serve both
 * that and material with real dynamics. Measuring against a rolling window makes
 * a drop read as a drop at any mastering level.
 *
 * Every time constant is expressed in seconds and converted with the frame
 * delta, so a 60 fps preview and a 30 fps export converge on the same envelope —
 * otherwise renders would not match what was previewed.
 */

/** How the raw band level is turned into the number a volume link rides. */
export interface AudioResponse {
   /** 0 = twitchy and immediate, 1 = slow and glidey. Sets the follower's release. */
   smoothing: number;
   /** Response curve. Low lifts quiet detail, high leaves only the big hits. */
   punch: number;
}

export const DEFAULT_AUDIO_RESPONSE: AudioResponse = {
   smoothing: 0.45,
   punch: 0.4,
};

/** Exponent applied after auto-ranging. 0.4 reproduces the old fixed 1.5. */
export function punchExponent(punch: number): number {
   return 0.5 + clamp01(punch) * 2.5;
}

const CEIL_DECAY_TAU = 2.5;
/** Slower than the ceiling so a loud passage doesn't erase its own headroom. */
const FLOOR_RISE_TAU = 4;
/**
 * The envelope used to snap straight onto any new extreme, which let one
 * transient own the whole range and drop every other frame near the floor.
 * Reaching for extremes over a few hundred ms instead means a peak has to be
 * more than a blip to widen the window — and a genuine drop still lands well
 * inside it, since anything past the ceiling clamps to 1.
 */
const CEIL_RISE_TAU = 0.3;
const FLOOR_FALL_TAU = 0.3;
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

function clamp01(v: number): number {
   return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A stalled clock would otherwise snap a follower straight to its input. */
function stepOf(dt: number): number {
   return Math.max(0, Math.min(dt, 0.25));
}

function approach(current: number, target: number, tau: number, step: number): number {
   return current + (target - current) * (1 - Math.exp(-step / tau));
}

/**
 * Attack and release of the band follower, in seconds, for a smoothing amount.
 *
 * Asymmetric on purpose: the rise stays quick so a kick still reads as a kick,
 * while the fall is several times longer so the level glides back down instead
 * of dropping out between hits. A symmetric follower fast enough to catch the
 * transient is also fast enough to flicker on every gap in the signal.
 */
function followerTaus(smoothing: number): { attack: number; release: number } {
   const s = clamp01(smoothing);
   return { attack: 0.02 + s * 0.08, release: 0.05 + s * s * 0.95 };
}

/**
 * One-pole envelope follow of a raw band level, stepped in seconds.
 *
 * The preview took this from the AnalyserNode, which the offline export has no
 * equivalent for — so a render fed auto-ranging raw, twitchy per-frame FFT
 * values while the preview fed it a smoothed curve. Doing it here, off the frame
 * delta, is what makes the two agree — and frees the preview from its dependence
 * on the monitor's refresh rate.
 */
export function smoothBandLevel(
   key: string,
   level: number,
   dt: number,
   smoothing: number = DEFAULT_AUDIO_RESPONSE.smoothing,
): number {
   const prev = smoothed.get(key);
   if (prev === undefined) {
      smoothed.set(key, level);
      return level;
   }
   const { attack, release } = followerTaus(smoothing);
   const next = approach(
      prev,
      level,
      level > prev ? attack : release,
      stepOf(dt),
   );
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

   const step = stepOf(dt);

   // Asymmetric: reach for new extremes quickly, drift back from them slowly.
   env.ceil = approach(
      env.ceil,
      level,
      level > env.ceil ? CEIL_RISE_TAU : CEIL_DECAY_TAU,
      step,
   );
   env.floor = approach(
      env.floor,
      level,
      level < env.floor ? FLOOR_FALL_TAU : FLOOR_RISE_TAU,
      step,
   );

   // A band with no dynamics used to bail out at 0, snapping every param linked
   // to it to the bottom of its range the moment the music went steady. Instead
   // the ranged reading fades back into the raw level as the span closes, so a
   // steady band reads steady where it actually sits — and silence still reads
   // as silence rather than as the bottom of a meaningless window.
   const span = env.ceil - env.floor;
   const pos = clamp01((level - env.floor) / Math.max(span, MIN_SPAN));
   const confidence = clamp01(span / MIN_SPAN);
   return pos * confidence + clamp01(level) * (1 - confidence);
}
