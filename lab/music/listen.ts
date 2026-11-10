// What every Music Lab visual hears: the song read once into tables indexed by time, so
// a frame depends only on its timestamp.

import { followerTaus } from "../../src/lib/audio/auto-range";
import {
	blendBand,
	PROFILE_FPS,
	type BandProfile,
	type Range,
	type SongProfile,
} from "../../src/lib/audio/song-profile";

const FPS = PROFILE_FPS;

/** The weakest a hit may be at full sensitivity. */
const MIN_ONSET_LEVEL = 0.02;
/** How far apart the two seconds either side of a moment must sit to count as a new
 * section of the song. */
const NOVELTY_WINDOW = 2 * FPS;
/** The jump in energy that counts as a new section at no sensitivity. */
const NOVELTY_CEILING = 0.28;
const MIN_SECTION_HOLD = 4;
const SNAP_TO_ONSET = 0.5;

export interface SongAudio {
	duration: number;
	frames: number;
	/** Kept so a band can be read again as its range is dragged. */
	profile: SongProfile;
}

export function follow(values: Float32Array, smoothing: number): Float32Array {
	const { attack, release } = followerTaus(smoothing);
	const up = attack > 0 ? 1 - Math.exp(-1 / FPS / attack) : 1;
	const down = 1 - Math.exp(-1 / FPS / release);
	const out = new Float32Array(values.length);
	let env = 0;
	for (let i = 0; i < values.length; i++) {
		env += (values[i] - env) * (values[i] >= env ? up : down);
		out[i] = env;
	}
	return out;
}

/** A band with nothing in it has a range below zero, where silence reads as full. */
export function usable({ floor, ceil }: Range): Range {
	const low = Math.max(floor, 0);
	return ceil > low ? { floor: low, ceil } : { floor: 0, ceil: 1 };
}

export function ride(band: BandProfile, punch: number, smoothing: number) {
	const ranges = { level: usable(band.level), hits: usable(band.hits) };
	const blended = band.levels.map((level, i) =>
		blendBand(level, band.hitLevels[i], ranges, punch),
	);
	return follow(blended, smoothing);
}

export function findOnsets(
	hits: Float32Array,
	sense: number,
	spacing: number,
): number[] {
	const level = Math.max(MIN_ONSET_LEVEL, 1 - sense);
	const onsets: number[] = [];
	const gap = Math.ceil(spacing * FPS);
	let last = -gap;
	for (let i = 1; i < hits.length; i++) {
		if (hits[i] < level || hits[i] <= hits[i - 1] || i - last < gap) continue;
		onsets.push(i);
		last = i;
	}
	return onsets;
}

/** Where the figure changes: at a new section of the song, or after `morphEvery` seconds
 * without one, moved onto the next hit so the change lands with the music. */
export function findCuts(
	energy: Float32Array,
	onsets: number[],
	morphEvery: number,
	/** 0 leaves only the timer. */
	sectionSense = 0.5,
): number[] {
	const n = energy.length;
	const noveltyCut =
		sectionSense > 0 ? NOVELTY_CEILING * (1 - sectionSense) : Infinity;
	const sums = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + energy[i];
	const mean = (a: number, b: number) => {
		const lo = Math.max(0, a);
		const hi = Math.min(n, b);
		return hi > lo ? (sums[hi] - sums[lo]) / (hi - lo) : 0;
	};
	const novelty = (i: number) =>
		Math.abs(mean(i, i + NOVELTY_WINDOW) - mean(i - NOVELTY_WINDOW, i));
	const isPeak = (i: number) => {
		const here = novelty(i);
		if (here < noveltyCut) return false;
		for (let d = 1; d <= FPS; d += 4) {
			if (novelty(i - d) > here || novelty(i + d) > here) return false;
		}
		return true;
	};

	const hold = MIN_SECTION_HOLD * FPS;
	const every = Math.max(MIN_SECTION_HOLD, morphEvery) * FPS;
	const snap = SNAP_TO_ONSET * FPS;
	const cuts: number[] = [];
	let last = 0;
	let next = 0;
	for (let i = hold; i < n; i++) {
		if (i - last < every && !(i - last >= hold && isPeak(i))) continue;
		while (next < onsets.length && onsets[next] < i) next++;
		const onset = onsets[next];
		const at = onset !== undefined && onset - i <= snap ? onset : i;
		cuts.push(at);
		last = at;
		i = at;
	}
	return cuts;
}

/** A table's value at `t`, between its frames. */
export function sampleAt(values: Float32Array, t: number): number {
	const x = Math.max(0, Math.min(values.length - 1, t * FPS));
	const i = Math.floor(x);
	const j = Math.min(values.length - 1, i + 1);
	return values[i] + (values[j] - values[i]) * (x - i);
}
