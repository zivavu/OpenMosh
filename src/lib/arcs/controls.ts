// The song, read once into a table indexed by time. A frame depends only on its
// timestamp, so seeking, replaying and exporting all land on the same picture.

import { followerTaus } from "../audio/auto-range";
import {
	blendBand,
	placeInRange,
	PROFILE_FPS,
	songBand,
	type BandProfile,
	type Range,
	type SongProfile,
} from "../audio/song-profile";
import type { Look } from "./look";

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
export const MORPH_SECONDS = 1.2;
/** How much of a section's music it takes to finish its figure; the rest shows it whole. */
const PEN_FINISHES_AT = 0.7;
/** A hit moves the pen as far as this many seconds of full energy. */
const HIT_PEN = 0.3;
/** The quickest a whole figure can be drawn, or a section whose music only starts at its
 * end would throw its figure up at once. */
const MIN_DRAW_SECONDS = 1.5;
/** The energy at which the picture is fully there. */
const FULL_PRESENCE = 0.2;

export interface SongAudio {
	duration: number;
	frames: number;
	/** Kept so a band can be read again as its range is dragged. */
	profile: SongProfile;
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
	/** How much of the picture there is: none in silence. */
	presence: Float32Array;
	/** How far through its section's figure the pen is, 0 to 1. */
	pen: Float32Array;
	/** How far the last section's figure has been erased, once the next one starts. */
	morph: Float32Array;
	/** The song sections being left and entered; the same outside a change. */
	sectionA: Uint16Array;
	sectionB: Uint16Array;
	/** Frames where a new section starts. */
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
	presence: number;
	morph: number;
	sectionA: number;
	sectionB: number;
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

function findOnsets(
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

/** Quick enough to rerun as a knob moves; only `analyzeDrive` touches the audio. */
export function buildControls(song: SongAudio, look: Look): Controls {
	const { frames } = song;
	const bandOf = (a: number, b: number) =>
		songBand(song.profile, Math.min(a, b), Math.max(a, b));
	const hitBand = bandOf(look.hitFreqLow, look.hitFreqHigh);
	const lowHits = usable(hitBand.hits);
	const hits = hitBand.hitLevels.map((v) => placeInRange(v, lowHits));
	const kick = follow(hits, look.hitSmooth);
	const bass = ride(
		bandOf(look.bassFreqLow, look.bassFreqHigh),
		look.bassPunch,
		look.bassSmooth,
	);
	const mid = ride(
		bandOf(look.midFreqLow, look.midFreqHigh),
		look.midPunch,
		look.midSmooth,
	);
	const high = ride(
		bandOf(look.highFreqLow, look.highFreqHigh),
		look.highPunch,
		look.highSmooth,
	);
	const blend = bass.map((b, i) => 0.5 * b + 0.3 * mid[i] + 0.2 * high[i]);
	const energy = follow(blend, look.energySmooth);

	const energyTotal = new Float32Array(frames);
	let total = 0;
	for (let i = 0; i < frames; i++) {
		total += (energy[i] * energy[i]) / FPS;
		energyTotal[i] = total;
	}

	const onsets = findOnsets(hits, look.hitSense, look.hitSpacing);
	const cuts = findCuts(energy, onsets, look.morphEvery, look.sectionSense);
	const onsetStrength = onsets.map((i) => hits[i]);
	const morphFrames = Math.ceil(MORPH_SECONDS * FPS);
	const morph = new Float32Array(frames);
	const sectionA = new Uint16Array(frames);
	const sectionB = new Uint16Array(frames);
	let cut = -1;
	for (let i = 0; i < frames; i++) {
		while (cut + 1 < cuts.length && cuts[cut + 1] <= i) cut++;
		const into = cut < 0 ? morphFrames : i - cuts[cut];
		sectionB[i] = cut + 1;
		sectionA[i] = into < morphFrames ? cut : cut + 1;
		if (into < morphFrames) morph[i] = into / morphFrames;
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
		presence: energy.map((e) => Math.min(1, e / FULL_PRESENCE)),
		pen: penTable(energy, onsets, onsetStrength, cuts),
		morph,
		sectionA,
		sectionB,
		cuts,
		onsets,
		onsetStrength,
	};
}

/** The music moves the pen: a section's energy creeps it on and its hits lurch it, shared
 * out so the figure is finished before the section ends, however loud it is. */
function penTable(
	energy: Float32Array,
	onsets: number[],
	strengths: number[],
	cuts: number[],
): Float32Array {
	const frames = energy.length;
	const travel = new Float32Array(frames);
	for (let i = 0; i < frames; i++) travel[i] = (energy[i] * energy[i]) / FPS;
	onsets.forEach((frame, o) => {
		travel[frame] += strengths[o] * HIT_PEN;
	});
	const pen = new Float32Array(frames);
	for (let section = 0; section <= cuts.length; section++) {
		const from = section > 0 ? cuts[section - 1] : 0;
		const to = cuts[section] ?? frames;
		let total = 0;
		for (let i = from; i < to; i++) total += travel[i];
		if (total <= 0) continue;
		const topSpeed = 1 / (MIN_DRAW_SECONDS * FPS);
		let sofar = 0;
		let at = 0;
		for (let i = from; i < to; i++) {
			sofar += travel[i];
			at = Math.min(at + topSpeed, sofar / total / PEN_FINISHES_AT, 1);
			pen[i] = at;
		}
	}
	return pen;
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
		presence: at(c.presence),
		morph: at(c.morph),
		sectionA: c.sectionA[i],
		sectionB: c.sectionB[i],
	};
}
