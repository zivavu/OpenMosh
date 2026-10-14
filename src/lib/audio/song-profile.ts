/** A whole song's levels, analysed once, so Audio Bars and the audio links place each
 * moment against the song's own quiet and loud parts rather than the last few seconds
 * played. That keeps an intro an intro, and makes a moment look the same however the
 * playhead got there, in preview and export alike. */

import { followerTaus } from "./auto-range";
import { SPECTRUM_MAX_DB, SPECTRUM_MIN_DB } from "./spectrum-scale";

/** Analysis rate: the preview's, so the song's peaks are read the way playback reads
 * them. At 20 a kick's peak fell between frames and the range sat above playback. */
export const PROFILE_FPS = 60;
/** About a bar of music: the stretches the song's loud parts are picked from. */
const STRETCH = 2 * PROFILE_FPS;
/** Stretches at least this loud, by rank, count as the song's loud parts. */
const LOUD_STRETCH_RANK = 0.6;
/** Where a link band's ranges sit within the loud parts. A hit's floor is their median:
 * every bin flickers a little, and only a rise past the usual flicker is a hit. */
const LEVEL_RANGE = [0.1, 0.97] as const;
const HIT_RANGE = [0.5, 0.97] as const;
const RIDE_RANGE = [0.05, 0.97] as const;
/** Narrowest range stretched to full scale, so a steady band doesn't amplify noise. */
const MIN_SPAN = 0.03;
/** Widest range: anything this far under the loud parts' peak reads as quiet. A drop
 * that goes silent between kicks would otherwise stretch to hold the intro. */
const MAX_LEVEL_SPAN_DB = 24;
/** Ride ranges kept per profile; each Smoothing and Punch pairing adds one. */
const MAX_RIDES = 64;
/** How fast a bin's floor drops onto a quieter reading, and creeps back up under a
 * louder one: a kick over a held bass still rises past the bass's floor. */
const HIT_FLOOR_FALL = 0.03;
const HIT_FLOOR_RISE = 0.25;

export interface Range {
	floor: number;
	ceil: number;
}

/** Where a band's readings sit across the song, read once per band. */
export interface BandProfile {
	level: Range;
	hits: Range;
	/** Per profile frame, for working out the ride range of a response. */
	levels: Float32Array;
	hitLevels: Float32Array;
	/** Profile frames inside the song's loud parts. */
	loudFrames: Uint32Array;
}

export interface SongProfile {
	sampleRate: number;
	fftSize: number;
	/** Each bin's level at the song's loud parts, 0-255 on the analysers' scale. */
	loud: Uint8Array;
	/** The song's non-silent frames, for working out a link band's range on demand. */
	frames: Uint8Array[];
	/** Bands already read, keyed by their edges. */
	bands: Map<string, BandProfile>;
	/** Ride ranges already worked out, keyed by band and response. */
	rides: Map<string, Range>;
}

const DB_PER_BYTE = (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB) / 255;
/** Each analyser byte as power over the window's floor; 0 is silence. */
const BYTE_POWER = Float64Array.from({ length: 256 }, (_, b) =>
	b === 0 ? 0 : 10 ** ((b * DB_PER_BYTE) / 10),
);

/** Power back on the 0-1 byte scale. */
function powerToLevel(power: number): number {
	if (power <= 1) return 0;
	return Math.min(1, (10 * Math.log10(power)) / DB_PER_BYTE / 255);
}

/** The FFT bins covering [freqMin, freqMax], clamped to the data; empty when none. */
export function bandBins(
	binCount: number,
	sampleRate: number,
	fftSize: number,
	freqMin: number,
	freqMax: number,
): { first: number; last: number } {
	return {
		first: Math.max(0, Math.floor((freqMin / sampleRate) * fftSize)),
		last: Math.min(binCount - 1, Math.ceil((freqMax / sampleRate) * fftSize)),
	};
}

/** The band's mean power over [freqMin, freqMax], back on the 0-1 byte scale: the
 * level a link band rides. Averaging power, not dB, lets a kick that lights a few bins
 * stand out from a pad spread over all of them. */
export function getLevelFromFrequencyRange(
	freqData: Uint8Array,
	sampleRate: number,
	fftSize: number,
	freqMin: number,
	freqMax: number,
): number {
	const { first, last } = bandBins(
		freqData.length,
		sampleRate,
		fftSize,
		freqMin,
		freqMax,
	);
	if (first > last) return 0;
	let sum = 0;
	for (let i = first; i <= last; i++) sum += BYTE_POWER[freqData[i]];
	return powerToLevel(sum / (last - first + 1));
}

/** The power the band's bins gained over their own recent floors this frame, back on
 * the 0-1 byte scale: kicks and snares, read apart from a bass or pad holding the band
 * up, and as loud as they hit. `floors` holds each bin's floor, as power, and carries
 * over between frames. */
export function stepBandHits(
	freqData: Uint8Array,
	first: number,
	last: number,
	floors: Float32Array,
	dt: number,
): number {
	if (first > last) return 0;
	const fall = 1 - Math.exp(-dt / HIT_FLOOR_FALL);
	const rise = 1 - Math.exp(-dt / HIT_FLOOR_RISE);
	let sum = 0;
	for (let i = first; i <= last; i++) {
		const p = BYTE_POWER[freqData[i]];
		const j = i - first;
		const floor = floors[j] < 0 ? p : floors[j];
		if (p > floor) sum += p - floor;
		floors[j] = floor + (p - floor) * (p < floor ? fall : rise);
	}
	return powerToLevel(sum / (last - first + 1));
}

function rangeAt(
	sorted: Float32Array,
	[lo, hi]: readonly [number, number],
	maxSpan = 1,
): Range {
	const at = (q: number) => sorted[Math.floor((sorted.length - 1) * q)] ?? 0;
	const ceil = at(hi);
	const floor = Math.max(at(lo), ceil - maxSpan);
	return { floor: Math.min(floor, ceil - MIN_SPAN), ceil };
}

function loudValues(values: Float32Array, loud: Uint32Array): Float32Array {
	return Float32Array.from(loud, (i) => values[i]).sort();
}

/** A band's level and hits through the song, and where its loud parts sit. */
export function songBand(
	profile: SongProfile,
	freqMin: number,
	freqMax: number,
): BandProfile {
	const key = `${freqMin}:${freqMax}`;
	let band = profile.bands.get(key);
	if (band) return band;
	const { frames, sampleRate, fftSize } = profile;
	const { first, last } = bandBins(
		fftSize / 2,
		sampleRate,
		fftSize,
		freqMin,
		freqMax,
	);
	const floors = new Float32Array(Math.max(0, last - first + 1)).fill(-1);
	const levels = new Float32Array(frames.length);
	const hitLevels = new Float32Array(frames.length);
	frames.forEach((frame, i) => {
		levels[i] = getLevelFromFrequencyRange(
			frame,
			sampleRate,
			fftSize,
			freqMin,
			freqMax,
		);
		hitLevels[i] = stepBandHits(frame, first, last, floors, 1 / PROFILE_FPS);
	});
	const stretches: number[] = [];
	for (let start = 0; start < levels.length; start += STRETCH) {
		const end = Math.min(levels.length, start + STRETCH);
		let sum = 0;
		for (let i = start; i < end; i++) sum += levels[i];
		stretches.push(sum / (end - start));
	}
	const cut = stretches.slice().sort((a, b) => a - b)[
		Math.floor((stretches.length - 1) * LOUD_STRETCH_RANK)
	];
	const loud: number[] = [];
	stretches.forEach((mean, s) => {
		if (mean < cut) return;
		const end = Math.min(levels.length, (s + 1) * STRETCH);
		for (let i = s * STRETCH; i < end; i++) loud.push(i);
	});
	const loudFrames = Uint32Array.from(loud);
	band = {
		level: rangeAt(
			loudValues(levels, loudFrames),
			LEVEL_RANGE,
			MAX_LEVEL_SPAN_DB / DB_PER_BYTE / 255,
		),
		hits: rangeAt(
			loudValues(hitLevels, loudFrames),
			HIT_RANGE,
			MAX_LEVEL_SPAN_DB / DB_PER_BYTE / 255,
		),
		levels,
		hitLevels,
		loudFrames,
	};
	profile.bands.set(key, band);
	return band;
}

/** Where `v` sits in a range, 0-1. */
export function placeInRange(v: number, { floor, ceil }: Range): number {
	const x = (v - floor) / (ceil - floor);
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The band's loudness and hits, each placed in its own range, blended by Punch. */
export function blendBand(
	level: number,
	hits: number,
	band: Pick<BandProfile, "level" | "hits">,
	punch: number,
): number {
	const body = placeInRange(level, band.level);
	return body + (placeInRange(hits, band.hits) - body) * punch;
}

/** Where the followed blend sits across the loud parts, so a slow Smoothing that
 * shaves the peaks still reaches the top. */
export function songRideRange(
	profile: SongProfile,
	freqMin: number,
	freqMax: number,
	smoothing: number,
	punch: number,
): Range {
	const key = `${freqMin}:${freqMax}:${smoothing}:${punch}`;
	let range = profile.rides.get(key);
	if (range) return range;
	const band = songBand(profile, freqMin, freqMax);
	const { attack, release } = followerTaus(smoothing);
	const dt = 1 / PROFILE_FPS;
	const upK = attack > 0 ? 1 - Math.exp(-dt / attack) : 1;
	const downK = 1 - Math.exp(-dt / release);
	const ride = new Float32Array(band.levels.length);
	let env = -1;
	band.levels.forEach((level, i) => {
		const v = blendBand(level, band.hitLevels[i], band, punch);
		env = env < 0 ? v : env + (v - env) * (v >= env ? upK : downK);
		ride[i] = env;
	});
	range = rangeAt(loudValues(ride, band.loudFrames), RIDE_RANGE);
	if (profile.rides.size >= MAX_RIDES) profile.rides.clear();
	profile.rides.set(key, range);
	return range;
}

let active: SongProfile | null = null;
let pending: Promise<unknown> | null = null;
let token = 0;

/** The profile of the song on screen, or null until it's analysed or with no song. */
export function activeSongProfile(): SongProfile | null {
	return active;
}

/** Make `load`'s profile the active one once it resolves; the previous one holds
 * until then, so a mix edit doesn't flicker. A later call supersedes an earlier one
 * still loading; pass null to clear. Loads run one at a time, each rendering the
 * whole mix, and one superseded before its turn never starts. */
export function publishSongProfile(
	load: (() => Promise<SongProfile | null>) | null,
): void {
	const mine = ++token;
	if (!load) {
		active = null;
		pending = null;
		return;
	}
	const start = () =>
		load().then(
			(profile) => {
				if (mine === token) active = profile;
			},
			() => {
				if (mine === token) active = null;
			},
		);
	const run = pending
		? pending.then(() => (mine === token ? start() : undefined))
		: start();
	pending = run;
	void run.finally(() => {
		if (pending === run) pending = null;
	});
}

/** Resolves once the profile being analysed is in, so an export doesn't start on the
 * fallback while the preview it should match uses the profile. */
export async function songProfileReady(): Promise<void> {
	while (pending) await pending;
}
