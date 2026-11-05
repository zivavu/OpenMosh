// The song, read once into a table indexed by time. A frame depends only on its
// timestamp, so seeking, replaying and exporting all land on the same picture.

import { followerTaus } from "../audio/auto-range";
import {
	blendBand,
	placeInRange,
	PROFILE_FPS,
	type BandProfile,
	type Range,
} from "../audio/song-profile";
import { mulberry32 } from "../rng";

const FPS = PROFILE_FPS;

/** A hit at least this strong, this far from the last, restarts the ripple. */
const ONSET_LEVEL = 0.55;
const ONSET_GAP = 0.12;
/** How far apart the two seconds either side of a moment must sit to count as a new
 * section of the song. */
const NOVELTY_WINDOW = 2 * FPS;
const NOVELTY_CUT = 0.14;
const MIN_FORM_HOLD = 4;
const SNAP_TO_ONSET = 0.5;
export const MORPH_SECONDS = 0.7;

export interface SongAudio {
	duration: number;
	frames: number;
	low: BandProfile;
	mid: BandProfile;
	high: BandProfile;
}

export interface Controls {
	frames: number;
	duration: number;
	kick: Float32Array;
	bass: Float32Array;
	mid: Float32Array;
	high: Float32Array;
	energy: Float32Array;
	/** Running total of energy, so the camera speeds up without ever jumping. */
	energyTotal: Float32Array;
	/** Seconds since the last strong hit. */
	kickAge: Float32Array;
	formA: Uint8Array;
	formB: Uint8Array;
	formMix: Float32Array;
	/** The song sections being left and entered; the same outside a form change. */
	sectionA: Uint16Array;
	sectionB: Uint16Array;
	/** How many strong hits have landed by each frame. */
	onsetIndex: Uint32Array;
	/** Frames where the form changes, for the song strip. */
	cuts: number[];
	/** Frames of the strong hits, and how hard each one hit. */
	onsets: number[];
	onsetStrength: number[];
}

export interface ControlFrame {
	t: number;
	kick: number;
	bass: number;
	mid: number;
	high: number;
	energy: number;
	energyTotal: number;
	kickAge: number;
	formA: number;
	formB: number;
	formMix: number;
	sectionA: number;
	sectionB: number;
	onsetIndex: number;
}

function follow(values: Float32Array, smoothing: number): Float32Array {
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
function usable({ floor, ceil }: Range): Range {
	const low = Math.max(floor, 0);
	return ceil > low ? { floor: low, ceil } : { floor: 0, ceil: 1 };
}

function ride(band: BandProfile, punch: number, smoothing: number) {
	const ranges = { level: usable(band.level), hits: usable(band.hits) };
	const blended = band.levels.map((level, i) =>
		blendBand(level, band.hitLevels[i], ranges, punch),
	);
	return follow(blended, smoothing);
}

function findOnsets(hits: Float32Array): number[] {
	const onsets: number[] = [];
	const gap = Math.ceil(ONSET_GAP * FPS);
	let last = -gap;
	for (let i = 1; i < hits.length; i++) {
		if (hits[i] < ONSET_LEVEL || hits[i] <= hits[i - 1] || i - last < gap)
			continue;
		onsets.push(i);
		last = i;
	}
	return onsets;
}

/** Where the form changes: at a new section of the song, or after `morphEvery` seconds
 * without one, moved onto the next hit so the change lands with the music. */
export function findCuts(
	energy: Float32Array,
	onsets: number[],
	morphEvery: number,
): number[] {
	const n = energy.length;
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
		if (here < NOVELTY_CUT) return false;
		for (let d = 1; d <= FPS; d += 4) {
			if (novelty(i - d) > here || novelty(i + d) > here) return false;
		}
		return true;
	};

	const hold = MIN_FORM_HOLD * FPS;
	const every = Math.max(MIN_FORM_HOLD, morphEvery) * FPS;
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

/** Quick enough to rerun as a knob moves; only `analyzeDrive` touches the audio. */
export function buildControls(
	song: SongAudio,
	seed: number,
	morphEvery: number,
	forms: number[],
): Controls {
	const { low, mid: midBand, high: highBand, frames } = song;
	const lowHits = usable(low.hits);
	const hits = low.hitLevels.map((v) => placeInRange(v, lowHits));
	const kick = follow(hits, 0.25);
	const bass = ride(low, 0.15, 0.6);
	const mid = ride(midBand, 0.3, 0.5);
	const high = ride(highBand, 0.7, 0.2);
	const blend = bass.map((b, i) => 0.5 * b + 0.3 * mid[i] + 0.2 * high[i]);
	const energy = follow(blend, 0.75);

	const energyTotal = new Float32Array(frames);
	let total = 0;
	for (let i = 0; i < frames; i++) {
		total += (energy[i] * energy[i]) / FPS;
		energyTotal[i] = total;
	}

	const onsets = findOnsets(hits);
	const kickAge = new Float32Array(frames).fill(1e3);
	for (let o = 0; o < onsets.length; o++) {
		const end = onsets[o + 1] ?? frames;
		for (let i = onsets[o]; i < end; i++) kickAge[i] = (i - onsets[o]) / FPS;
	}

	const onsetIndex = new Uint32Array(frames);
	for (let o = 0; o < onsets.length; o++) onsetIndex.fill(o + 1, onsets[o]);

	const cuts = findCuts(energy, onsets, morphEvery);
	const order = formOrder(cuts.length + 1, seed, forms);
	const formA = new Uint8Array(frames);
	const formB = new Uint8Array(frames);
	const formMix = new Float32Array(frames);
	const sectionA = new Uint16Array(frames);
	const sectionB = new Uint16Array(frames);
	const morph = Math.ceil(MORPH_SECONDS * FPS);
	let cut = -1;
	for (let i = 0; i < frames; i++) {
		while (cut + 1 < cuts.length && cuts[cut + 1] <= i) cut++;
		const into = cut < 0 ? morph : i - cuts[cut];
		const to = order[cut + 1];
		sectionB[i] = cut + 1;
		if (into >= morph) {
			formA[i] = formB[i] = to;
			sectionA[i] = cut + 1;
			continue;
		}
		const x = into / morph;
		sectionA[i] = cut;
		formA[i] = order[cut];
		formB[i] = to;
		formMix[i] = x * x * (3 - 2 * x);
	}

	return {
		frames,
		duration: song.duration,
		kick,
		bass,
		mid,
		high,
		energy,
		energyTotal,
		kickAge,
		formA,
		formB,
		formMix,
		sectionA,
		sectionB,
		onsetIndex,
		cuts,
		onsets,
		onsetStrength: onsets.map((i) => hits[i]),
	};
}

function formOrder(count: number, seed: number, forms: number[]): number[] {
	const pool = forms.length ? forms : [0];
	const rng = mulberry32(seed);
	const order: number[] = [];
	for (let i = 0; i < count; i++) {
		let pick = pool[Math.floor(rng() * pool.length)];
		if (pool.length > 1) {
			while (pick === order[i - 1]) {
				pick = pool[Math.floor(rng() * pool.length)];
			}
		}
		order.push(pick);
	}
	return order;
}

export function sampleControls(c: Controls, t: number): ControlFrame {
	const x = Math.max(0, Math.min(c.frames - 1, t * FPS));
	const i = Math.floor(x);
	const j = Math.min(c.frames - 1, i + 1);
	const f = x - i;
	const at = (a: Float32Array) => a[i] + (a[j] - a[i]) * f;
	return {
		t,
		kick: at(c.kick),
		bass: at(c.bass),
		mid: at(c.mid),
		high: at(c.high),
		energy: at(c.energy),
		energyTotal: at(c.energyTotal),
		// Not interpolated: it falls back to 0 on a hit, and a blend would sweep the ripple.
		kickAge: c.kickAge[i],
		formA: c.formA[i],
		formB: c.formB[i],
		formMix: c.formMix[i],
		sectionA: c.sectionA[i],
		sectionB: c.sectionB[i],
		onsetIndex: c.onsetIndex[i],
	};
}
