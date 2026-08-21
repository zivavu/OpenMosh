/**
 * Rolling normalization for the raw FFT bins the audio-bars visualizer draws.
 *
 * `getByteFrequencyData` maps the AnalyserNode's dB window (-100..-30 by
 * default) onto 0..255, and ordinary music only occupies a slice of that: bins
 * sit somewhere around 0.4..0.85 and never approach either end. Drawn straight,
 * the bars stand permanently half-height and a drop barely moves them.
 *
 * Two corrections, in order:
 *
 * 1. **Per-bin floor removal.** Each bin keeps its own rolling low, so what gets
 *    drawn is how far that band has risen above its own resting level rather
 *    than its absolute value. This is what reclaims the bottom of the range.
 * 2. **One shared ceiling.** The heights are then divided by a single rolling
 *    peak taken across every bin, not per bin. A per-bin ceiling would push
 *    every band to full scale independently and flatten the very thing being
 *    fixed — overall loudness would stop reading at all. Sharing it means a
 *    loud passage lifts every bar together, and because the ceiling is slow to
 *    follow, the dynamics show up before it catches up.
 *
 * Time constants are asymmetric for the reasons set out in `auto-range.ts` —
 * reach for a new extreme quickly, drift back from it slowly — and are stepped
 * in seconds off the frame delta, so a 60 fps preview and a 30 fps export
 * converge on the same envelope instead of the render disagreeing with what was
 * previewed.
 */

import { followerTaus } from "./auto-range";

/**
 * Effectively peak-hold. The ceiling has to be able to reach the top of a
 * transient inside the transient: at 0.3 it could not, so on percussive
 * material it sagged all the way down to MIN_CEIL, every bar clipped flat at
 * full height, and the display stopped resolving loud from very loud. Kept just
 * off instant so a single-frame spike still has to persist a beat to own the
 * range.
 */
const CEIL_RISE_TAU = 0.03;
const CEIL_FALL_TAU = 2.5;

/**
 * Window the per-bin floor takes its minimum over.
 *
 * The floor used to chase the signal itself whenever the signal sat above it,
 * which meant a repeated note kept nudging its own floor up and each repeat
 * read weaker than the one before even at identical volume. A minimum can only
 * rise on evidence that the quiet level really has risen, so repeats stay put.
 * Two windows are kept, so the effective lookback is one to two of these.
 */
const FLOOR_WINDOW = 2;
/**
 * Deliberately quicker than auto-range's equivalent. Until a bin's floor comes
 * back down, its height clamps at zero, so a hard cut into a breakdown blanks
 * the display entirely; at 0.3 that lasted ~300ms and read as a glitch rather
 * than as dynamics. Halving it costs nothing in steady state and still sits
 * well clear of the timescale the signal itself wobbles on.
 */
const FLOOR_FALL_TAU = 0.15;
/** Slower than the fall, so a sustained tone doesn't quietly erase itself. */
const FLOOR_RISE_TAU = 4;
/**
 * Smallest ceiling the heights are divided by, and so the smallest dynamic
 * range that gets expanded to full scale.
 *
 * Digital silence is safe at any value — every height is exactly 0. This
 * guards the more common case just above it: room tone, a fade tail, a filtered
 * pad. At 0.08 a signal barely moving off its own floor was still stretched to
 * around 60% height, so near-silence looked like a chorus. Real material clears
 * this comfortably — bins resting around 0.4..0.85 leave heights of 0.2 and up
 * once their floor is removed — so it only ever engages on material that
 * genuinely has no dynamics to show.
 */
const MIN_CEIL = 0.15;

let floors: Float32Array | null = null;
let heights: Float32Array | null = null;
let out: Uint8Array | null = null;
/** Running minimum of the window in progress, and of the one before it. */
let winMin: Float32Array | null = null;
let prevMin: Float32Array | null = null;
let windowT = 0;
let ceil = MIN_CEIL;

/** Call on any signal discontinuity: seek, track change, export start. */
export function resetSpectrumRange(): void {
  floors = null;
  heights = null;
  out = null;
  winMin = null;
  prevMin = null;
  windowT = 0;
  ceil = MIN_CEIL;
  followers.clear();
}

/** A stalled clock would otherwise snap the envelopes straight to their input. */
function stepOf(dt: number): number {
  return Math.max(0, Math.min(dt, 0.25));
}

function approach(current: number, target: number, tau: number, step: number): number {
  return current + (target - current) * (1 - Math.exp(-step / tau));
}

/**
 * Normalize one frame of FFT bins, returning a reused buffer.
 *
 * The result is only valid until the next call — it is uploaded to a texture
 * immediately and never retained.
 */
export function normalizeSpectrum(
  src: Uint8Array | null,
  dt: number,
): Uint8Array | null {
  if (!src || src.length === 0) return src;
  const n = src.length;
  if (!floors || floors.length !== n) {
    floors = new Float32Array(n);
    heights = new Float32Array(n);
    winMin = new Float32Array(n);
    prevMin = new Float32Array(n);
    out = new Uint8Array(n);
    // Seeded from this frame so playback opens where the music actually sits
    // rather than sweeping up from zero over the first few seconds.
    for (let i = 0; i < n; i++) {
      const v = src[i] / 255;
      floors[i] = v;
      winMin[i] = v;
      prevMin[i] = v;
    }
    windowT = 0;
    ceil = MIN_CEIL;
  }
  const step = stepOf(dt);
  const h = heights!;
  const o = out!;
  const wMin = winMin!;
  const pMin = prevMin!;

  let framePeak = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i] / 255;
    if (v < wMin[i]) wMin[i] = v;
    // Target the quietest this bin has been recently, not wherever it is now:
    // a bin that is currently loud says nothing about where its floor belongs.
    const target = wMin[i] < pMin[i] ? wMin[i] : pMin[i];
    const f = floors[i];
    floors[i] = approach(
      f,
      target,
      target < f ? FLOOR_FALL_TAU : FLOOR_RISE_TAU,
      step,
    );
    const height = v - floors[i];
    h[i] = height > 0 ? height : 0;
    if (h[i] > framePeak) framePeak = h[i];
  }

  // Roll the window: the one just finished becomes the comparison, and the next
  // starts open so a genuinely raised floor can still be discovered.
  windowT += step;
  if (windowT >= FLOOR_WINDOW) {
    windowT = 0;
    for (let i = 0; i < n; i++) {
      pMin[i] = wMin[i];
      wMin[i] = src[i] / 255;
    }
  }

  ceil = approach(
    ceil,
    framePeak,
    framePeak > ceil ? CEIL_RISE_TAU : CEIL_FALL_TAU,
    step,
  );
  const scale = 255 / Math.max(ceil, MIN_CEIL);
  for (let i = 0; i < n; i++) {
    const value = h[i] * scale;
    o[i] = value > 255 ? 255 : value;
  }
  return o;
}

/**
 * Per-instance envelope followers, keyed by effect instance id.
 *
 * Keyed rather than global because Smoothing is a parameter on the effect, so
 * two Audio Bars instances can legitimately want different ones off the same
 * frame of audio.
 */
const followers = new Map<string, Float32Array>();

/** Forget one instance's follower. Called when the effect goes away. */
export function dropSpectrumFollower(key: string): void {
  followers.delete(key);
}

/**
 * Envelope-follow an already-normalized frame, writing into `dest`.
 *
 * Attack and release come from the same curve the volume links use, so the
 * Smoothing slider means the same thing in both places: the rise stays quick so
 * a kick still reads as a kick, while the fall is several times longer so bars
 * glide back down instead of dropping out between hits.
 */
export function smoothSpectrum(
  key: string,
  src: Uint8Array,
  dest: Uint8Array,
  dt: number,
  smoothing: number,
): void {
  const n = src.length;
  let env = followers.get(key);
  if (!env || env.length !== n) {
    env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = src[i];
    followers.set(key, env);
  }
  const { attack, release } = followerTaus(smoothing);
  const step = stepOf(dt);
  const upK = 1 - Math.exp(-step / attack);
  const downK = 1 - Math.exp(-step / release);
  for (let i = 0; i < n; i++) {
    const v = src[i];
    env[i] += (v - env[i]) * (v > env[i] ? upK : downK);
    dest[i] = env[i];
  }
}
