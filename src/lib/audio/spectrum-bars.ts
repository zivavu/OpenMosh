/** Turns raw FFT bins into Audio Bars heights: one band per bar on a log-like scale,
 * read through a dB window under the song's loud parts, falling under gravity. The loud
 * parts come from the song profile; until it's in, the ceilings learn them as it plays. */

import { followerTaus } from "./auto-range";
import { SPECTRUM_MAX_DB, SPECTRUM_MIN_DB } from "./offline-audio";
import { activeSongProfile, type SongProfile } from "./song-profile";

const FREQ_MIN = 30;
/** Most lossy files cut off around here; bars above it would never move. */
const FREQ_MAX = 16000;
/** Bends the scale toward linear below about this, so the sub-bass, which only a few
 * FFT bins resolve, doesn't spend a fifth of the bars moving in lockstep. */
const SCALE_KNEE = 50;
/** Music loses roughly this much per octave; adding it back lets the highs reach the top. */
const TILT_DB_PER_OCTAVE = 3;
const TILT_PIVOT = 1000;
/** Span of the window under the ceiling: anything this far below it draws nothing. */
const RANGE_DB = 36;
/** How far each bar's window follows its own loudest moments instead of the loudest
 * bar's, so a band that's quiet all song still reaches the top on its own hits. */
const BAND_CONTRAST = 0.5;
/** Where the learned ceiling starts: about where a loud master's chorus peaks, so an
 * intro reads as an intro instead of being stretched to full height before the drop. */
const CEIL_START_DB = -24;
/** Slow both ways, so the window holds the song's loud parts rather than its last few
 * seconds: a quiet stretch stays small and a drop towers over it. */
const CEIL_RISE_TAU = 1;
const CEIL_FALL_TAU = 60;
/** Lowest the ceiling sinks, so a quiet recording, fade tail or room tone isn't
 * stretched to full height. */
const MIN_CEIL_DB = -30;
/** A cap rests on its high point this long before it starts to fall. */
const PEAK_HOLD = 0.35;
/** A cap's fall acceleration, in heights per second squared. */
const PEAK_GRAVITY = 2.5;

interface BarState {
	count: number;
	ceil: number;
	/** Each bar's own ceiling, on the same rise and fall as the shared one. */
	bandCeil: Float32Array;
	target: Float32Array;
	level: Float32Array;
	velocity: Float32Array;
	peak: Float32Array;
	peakVelocity: Float32Array;
	peakHold: Float32Array;
	/** Interleaved level and cap per bar, 0-255, ready for an RG8 texture. */
	out: Uint8Array;
}

/** Keyed by effect instance: bar count and Smoothing are per-effect parameters. */
const states = new Map<string, BarState>();

/** Call on any signal discontinuity: seek, track change, export start. */
export function resetSpectrumBars(): void {
	states.clear();
}

/** Forget one instance's state when the effect goes away. */
export function dropSpectrumBars(key: string): void {
	states.delete(key);
}

function scale(hz: number): number {
	return Math.log(1 + hz / SCALE_KNEE);
}

const edgeCache = new Map<number, Float32Array>();

/** Band edges in Hz, `count + 1` of them, evenly spaced on the bar scale. */
export function barEdges(count: number): Float32Array {
	let edges = edgeCache.get(count);
	if (!edges) {
		edges = new Float32Array(count + 1);
		const lo = scale(FREQ_MIN);
		const hi = scale(FREQ_MAX);
		for (let i = 0; i <= count; i++) {
			edges[i] = SCALE_KNEE * (Math.exp(lo + ((hi - lo) * i) / count) - 1);
		}
		edgeCache.set(count, edges);
	}
	return edges;
}

/** Loudest bin in the band, or the value interpolated at its centre when the band is
 * narrower than a bin, in dB with the tilt applied. */
function bandDb(
	bins: Uint8Array,
	binHz: number,
	lo: number,
	hi: number,
): number {
	const last = bins.length - 1;
	const centre = Math.sqrt(lo * hi);
	const x = Math.min(centre / binHz, last);
	const i0 = Math.floor(x);
	const t = x - i0;
	let byte = bins[i0] * (1 - t) + bins[Math.min(i0 + 1, last)] * t;
	const end = Math.min(Math.floor(hi / binHz), last);
	for (let k = Math.ceil(lo / binHz); k <= end; k++) {
		if (bins[k] > byte) byte = bins[k];
	}
	const db =
		SPECTRUM_MIN_DB + (byte / 255) * (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB);
	return db + TILT_DB_PER_OCTAVE * Math.log2(centre / TILT_PIVOT);
}

function topOf(ceil: number, own: number): number {
	const shared = Math.max(ceil, MIN_CEIL_DB);
	return shared + (Math.max(own, MIN_CEIL_DB) - shared) * BAND_CONTRAST;
}

const songTops = new WeakMap<SongProfile, Map<number, Float32Array>>();

/** Each bar's ceiling from the whole song's loud parts, so it never depends on what
 * has played so far. */
function songTopsOf(profile: SongProfile, bars: number): Float32Array {
	let byCount = songTops.get(profile);
	if (!byCount) {
		byCount = new Map();
		songTops.set(profile, byCount);
	}
	let tops = byCount.get(bars);
	if (!tops) {
		const edges = barEdges(bars);
		const binHz = profile.sampleRate / 2 / profile.loud.length;
		tops = new Float32Array(bars);
		let ceil = -Infinity;
		for (let b = 0; b < bars; b++) {
			tops[b] = bandDb(profile.loud, binHz, edges[b], edges[b + 1]);
			if (tops[b] > ceil) ceil = tops[b];
		}
		for (let b = 0; b < bars; b++) tops[b] = topOf(ceil, tops[b]);
		byCount.set(bars, tops);
	}
	return tops;
}

/** Seconds a bar takes to fall its full height from rest, for a smoothing amount. */
export function barFallTime(smoothing: number): number {
	return 0.1 + followerTaus(smoothing).release;
}

/** Rise time constant: instant with no smoothing, so a kick lands on its frame. */
function barAttack(smoothing: number): number {
	const s = Math.max(0, Math.min(1, smoothing));
	return 0.1 * s * s;
}

function createState(count: number): BarState {
	return {
		count,
		ceil: CEIL_START_DB,
		bandCeil: new Float32Array(count).fill(CEIL_START_DB),
		target: new Float32Array(count),
		level: new Float32Array(count),
		velocity: new Float32Array(count),
		peak: new Float32Array(count),
		peakVelocity: new Float32Array(count),
		peakHold: new Float32Array(count),
		out: new Uint8Array(count * 2),
	};
}

/** A stalled clock would otherwise drop every bar in one step. */
function stepOf(dt: number): number {
	return Math.max(0, Math.min(dt, 0.25));
}

/** Step one instance's bars by `dt` seconds and return them as interleaved level and
 * cap bytes. The buffer is reused, valid until the next call for the same key. Null
 * bins read as silence, so the bars fall rather than freeze when the music stops. */
export function stepSpectrumBars(
	key: string,
	bins: Uint8Array | null,
	sampleRate: number,
	dt: number,
	count: number,
	smoothing: number,
): Uint8Array {
	const bars = Math.max(1, Math.floor(count));
	let state = states.get(key);
	if (!state || state.count !== bars) {
		state = createState(bars);
		states.set(key, state);
	}
	const step = stepOf(dt);
	const target = state.target;
	target.fill(0);

	if (bins && bins.length > 1 && sampleRate > 0) {
		const edges = barEdges(bars);
		const binHz = sampleRate / 2 / bins.length;
		let loudest = -Infinity;
		for (let b = 0; b < bars; b++) {
			target[b] = bandDb(bins, binHz, edges[b], edges[b + 1]);
			if (target[b] > loudest) loudest = target[b];
		}
		const profile = activeSongProfile();
		const tops = profile ? songTopsOf(profile, bars) : null;
		// Without a profile yet, the ceilings learn the song as it plays.
		const tau = loudest > state.ceil ? CEIL_RISE_TAU : CEIL_FALL_TAU;
		state.ceil += (loudest - state.ceil) * (1 - Math.exp(-step / tau));
		const riseK = 1 - Math.exp(-step / CEIL_RISE_TAU);
		const fallK = 1 - Math.exp(-step / CEIL_FALL_TAU);
		for (let b = 0; b < bars; b++) {
			const db = target[b];
			const bc = state.bandCeil[b];
			state.bandCeil[b] += (db - bc) * (db > bc ? riseK : fallK);
			const top = tops ? tops[b] : topOf(state.ceil, state.bandCeil[b]);
			const v = (db - (top - RANGE_DB)) / RANGE_DB;
			target[b] = v < 0 ? 0 : v > 1 ? 1 : v;
		}
	}

	const attack = barAttack(smoothing);
	const attackK = attack > 0 ? 1 - Math.exp(-step / attack) : 1;
	const fall = barFallTime(smoothing);
	const gravity = 2 / (fall * fall);
	const { level, velocity, peak, peakVelocity, peakHold, out } = state;
	for (let b = 0; b < bars; b++) {
		if (target[b] >= level[b]) {
			level[b] += (target[b] - level[b]) * attackK;
			velocity[b] = 0;
		} else {
			velocity[b] += gravity * step;
			level[b] = Math.max(target[b], level[b] - velocity[b] * step);
		}

		if (level[b] >= peak[b]) {
			peak[b] = level[b];
			peakVelocity[b] = 0;
			peakHold[b] = PEAK_HOLD;
		} else if (peakHold[b] > 0) {
			peakHold[b] -= step;
		} else {
			peakVelocity[b] += PEAK_GRAVITY * step;
			peak[b] = Math.max(level[b], peak[b] - peakVelocity[b] * step);
		}

		out[b * 2] = Math.round(level[b] * 255);
		out[b * 2 + 1] = Math.round(peak[b] * 255);
	}
	return out;
}
