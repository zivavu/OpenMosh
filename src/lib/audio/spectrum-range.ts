/** Rolling normalization for the raw FFT bins the audio-bars visualizer draws: each
 * bin subtracts its own rolling floor, then all heights divide by one shared peak. */

import { followerTaus } from "./auto-range";

/** Effectively peak-hold: the ceiling must reach a transient's top within the
 * transient, or percussive material sags to MIN_CEIL and clips flat. */
const CEIL_RISE_TAU = 0.03;
const CEIL_FALL_TAU = 2.5;

/** Window the per-bin floor takes its minimum over. A floor that chased the signal
 * let a repeated note nudge its own floor up, so each repeat read weaker. */
const FLOOR_WINDOW = 2;
/** Deliberately quicker than auto-range's equivalent: until a bin's floor comes back
 * down its height clamps at zero, so a hard cut into a breakdown blanks the display. */
const FLOOR_FALL_TAU = 0.15;
/** Slower than the fall, so a sustained tone doesn't quietly erase itself. */
const FLOOR_RISE_TAU = 4;
/** Smallest ceiling the heights divide by, and so the smallest dynamic range expanded
 * to full scale. Guards near-silence (room tone, fade tail) from looking like a chorus. */
const MIN_CEIL = 0.15;

let floors: Float32Array | null = null;
let heights: Float32Array | null = null;
let out: Uint8Array | null = null;
/** Running minimum of the current window and the one before it. */
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

function approach(
	current: number,
	target: number,
	tau: number,
	step: number,
): number {
	return current + (target - current) * (1 - Math.exp(-step / tau));
}

/** Normalize one frame of FFT bins into a reused buffer, valid only until the next
 * call: it is uploaded to a texture immediately. */
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
		// Seeded from this frame so playback opens where the music sits, not at zero.
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
		// Target the quietest this bin has been recently, not where it is now.
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

	// Roll the window: the finished one becomes the comparison, the next starts open.
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

/** Per-instance envelope followers, keyed by effect instance id: Smoothing is a
 * per-effect parameter, so two Audio Bars can want different ones off one frame. */
const followers = new Map<string, Float32Array>();

/** Forget one instance's follower when the effect goes away. */
export function dropSpectrumFollower(key: string): void {
	followers.delete(key);
}

/** Envelope-follow an already-normalized frame into `dest`, using the same attack and
 * release curve as the volume links so Smoothing means the same in both places. */
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
