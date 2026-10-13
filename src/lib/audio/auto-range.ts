/** Per-band state behind the audio links: the envelope follower, each bin's recent
 * floor for reading hits, and the rolling range used until a song profile is in. Keyed
 * by band and cleared together on a discontinuity. */

/** How the raw band level is turned into the number a volume link rides. */
export interface AudioResponse {
	/** 0 strobes on every hit, 1 swells: how slowly the link rises and falls. */
	smoothing: number;
	/** 0 rides the band's loudness, 1 only its hits: kicks, snares, plucks. */
	punch: number;
}

export const DEFAULT_AUDIO_RESPONSE: AudioResponse = {
	smoothing: 0.45,
	punch: 0.4,
};

/** Audio Bars' curve on its bar heights: below 1 lifts quiet detail, above it leaves
 * only the big hits. */
export function punchExponent(punch: number): number {
	return 0.5 + clamp01(punch) * 2.5;
}

/** A link's curve on its ride: under 1 lifts the quiet detail of a loudness ride, over
 * 1 leaves a hit ride its strong hits. */
export function rideExponent(punch: number): number {
	return 0.7 * (1.6 / 0.7) ** clamp01(punch);
}

const CEIL_DECAY_TAU = 2.5;
/** Slower than the ceiling so a loud passage doesn't erase its own headroom. */
const FLOOR_RISE_TAU = 4;
/** Reaching for extremes over a few hundred ms, not instantly, so one transient cannot
 * own the whole range; anything past the ceiling still clamps to 1. */
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
const hitFloors = new Map<string, Float32Array>();

/** Call on any signal discontinuity: seek, track change, export start. */
export function resetAutoRange(): void {
	envelopes.clear();
	smoothed.clear();
	hitFloors.clear();
}

/** Forget one scope's bands. Scopes are fx lane ids, so without this a deleted lane's
 * envelopes sat here for the rest of the session. */
export function dropAutoRangeScope(scope: string): void {
	const prefix = `${scope}|`;
	for (const key of envelopes.keys()) {
		if (key.startsWith(prefix)) envelopes.delete(key);
	}
	for (const key of smoothed.keys()) {
		if (key.startsWith(prefix)) smoothed.delete(key);
	}
	for (const key of hitFloors.keys()) {
		if (key.startsWith(prefix)) hitFloors.delete(key);
	}
}

/** A band's per-bin floors for `stepBandHits`, kept across frames; -1 until seen. */
export function hitFloorsOf(key: string, bins: number): Float32Array {
	let floors = hitFloors.get(key);
	if (!floors || floors.length !== bins) {
		floors = new Float32Array(bins).fill(-1);
		hitFloors.set(key, floors);
	}
	return floors;
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A stalled clock would otherwise snap a follower straight to its input. */
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

/** The band follower's rise and fall, in seconds, for a smoothing amount. Up to the
 * middle it rises at once, so a kick lands on its frame; past it the rise eases in
 * too, until the link swells with the music instead of hitting. */
export function followerTaus(smoothing: number): {
	attack: number;
	release: number;
} {
	const s = clamp01(smoothing);
	return {
		attack: s <= 0.5 ? 0 : 0.3 * ((s - 0.5) / 0.5) ** 2,
		release: 0.03 * 30 ** s,
	};
}

/** Envelope follow of a band reading, stepped in seconds. */
export function smoothBandLevel(
	key: string,
	level: number,
	dt: number,
	smoothing: number = DEFAULT_AUDIO_RESPONSE.smoothing,
): number {
	const prev = smoothed.get(key);
	const { attack, release } = followerTaus(smoothing);
	const tau = prev === undefined ? 0 : level >= prev ? attack : release;
	const next = tau === 0 ? level : approach(prev!, level, tau, stepOf(dt));
	smoothed.set(key, next);
	return next;
}

/** Position of `level` in the band's recent range, in [0, 1]: the stand-in for the
 * song's own range until a profile is in. */
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

	// A band with no dynamics used to bail out at 0, snapping every linked param to the
	// bottom of its range. Instead the ranged reading fades into the raw level as span closes.
	const span = env.ceil - env.floor;
	const pos = clamp01((level - env.floor) / Math.max(span, MIN_SPAN));
	const confidence = clamp01(span / MIN_SPAN);
	return pos * confidence + clamp01(level) * (1 - confidence);
}
