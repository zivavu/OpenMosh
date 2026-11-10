// The song read for Pulsar: a table indexed by time, so the picture at a moment is the
// same however playback got there (the feedback trails aside, which settle in a second).

import {
	placeInRange,
	PROFILE_FPS,
	songBand,
} from "../../../src/lib/audio/song-profile";
import { mulberry32 } from "../../../src/lib/rng";
import {
	findCuts,
	findOnsets,
	follow,
	ride,
	sampleAt,
	usable,
	type SongAudio,
} from "../listen";
import type { PulsarLook } from "./look";

const FPS = PROFILE_FPS;
const BASS: [number, number] = [30, 140];
const MID: [number, number] = [250, 2500];
const HIGH: [number, number] = [5000, 14000];
/** The energy at which the picture is fully lit. */
const FULL_PRESENCE = 0.2;
/** The motion clock runs this fast in a quiet bit, and up to one more at full energy. */
const IDLE_DRIFT = 0.3;
const FOLDS = [5, 6, 6, 7, 8, 8, 10, 12];

export const Mode = { Dark: 0, Ink: 1, Field: 2 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export interface Section {
	fold: number;
	/** Where between a plain polygon and its sharpest star the wireframe sits. */
	star: number;
	orbits: number;
	spin: number;
	phase: number;
	mode: Mode;
}

export interface PulsarTable {
	frames: number;
	duration: number;
	kick: Float32Array;
	bass: Float32Array;
	mid: Float32Array;
	high: Float32Array;
	energy: Float32Array;
	presence: Float32Array;
	/** A clock that runs faster when the music is loud, so motion speeds up without a jump. */
	drift: Float32Array;
	/** 1 on a hit, dying away over the flash length. */
	flash: Float32Array;
	/** Frames a hit has snapped to the other side of dark and ink. */
	snap: Uint8Array;
	section: Uint16Array;
	sections: Section[];
	cuts: number[];
	onsets: number[];
}

export interface PulsarFrame {
	kick: number;
	bass: number;
	mid: number;
	high: number;
	energy: number;
	presence: number;
	drift: number;
	flash: number;
	section: Section;
	mode: Mode;
}

function pickMode(rand: () => number, look: PulsarLook): Mode {
	const r = rand() * Math.max(1, look.inkShare + look.fieldShare);
	return r < look.inkShare
		? Mode.Ink
		: r < look.inkShare + look.fieldShare
			? Mode.Field
			: Mode.Dark;
}

/** The song opens dark, and each new section tries not to repeat its mode. */
export function rollSections(count: number, look: PulsarLook): Section[] {
	const sections: Section[] = [];
	for (let i = 0; i < count; i++) {
		const rand = mulberry32((look.seed * 0x9e3779b1) ^ (i * 0x85ebca6b));
		let mode = i === 0 ? Mode.Dark : pickMode(rand, look);
		if (i > 0 && mode === sections[i - 1].mode) mode = pickMode(rand, look);
		sections.push({
			fold: FOLDS[Math.floor(rand() * FOLDS.length)],
			star: rand(),
			orbits: 2 + Math.floor(rand() * 3),
			spin: rand() < 0.5 ? -1 : 1,
			phase: rand() * Math.PI * 2,
			mode,
		});
	}
	return sections;
}

export function buildPulsarTable(
	song: SongAudio,
	look: PulsarLook,
): PulsarTable {
	const { frames } = song;
	const band = ([a, b]: [number, number]) => songBand(song.profile, a, b);
	const hitBand = band([
		Math.min(look.hitFreqLow, look.hitFreqHigh),
		Math.max(look.hitFreqLow, look.hitFreqHigh),
	]);
	const hitRange = usable(hitBand.hits);
	const hits = hitBand.hitLevels.map((v) => placeInRange(v, hitRange));
	const kick = follow(hits, look.hitSmooth);
	const bass = ride(band(BASS), look.bassPunch, look.bassSmooth);
	const mid = ride(band(MID), look.midPunch, look.midSmooth);
	const high = ride(band(HIGH), look.highPunch, look.highSmooth);
	const energy = follow(
		bass.map((b, i) => 0.5 * b + 0.3 * mid[i] + 0.2 * high[i]),
		look.energySmooth,
	);

	const drift = new Float32Array(frames);
	let clock = 0;
	for (let i = 0; i < frames; i++) {
		clock += (IDLE_DRIFT + energy[i]) / FPS;
		drift[i] = clock;
	}

	const onsets = findOnsets(hits, look.hitSense, look.hitSpacing);
	const flash = new Float32Array(frames);
	const snap = new Uint8Array(frames);
	const flashFrames = look.flashLength * FPS;
	const snapFrames = Math.max(1, Math.round(look.snapLength * FPS));
	const snapRand = mulberry32(look.seed ^ 0x5bd1e995);
	for (const at of onsets) {
		const strength = hits[at];
		const end = Math.min(frames, at + Math.ceil(flashFrames * 4));
		for (let i = at; i < end; i++) {
			const v = strength * Math.exp(-(i - at) / flashFrames);
			if (v > flash[i]) flash[i] = v;
		}
		if (snapRand() < look.snapChance) {
			snap.fill(1, at, Math.min(frames, at + snapFrames));
		}
	}

	const cuts = findCuts(energy, onsets, look.morphEvery, look.sectionSense);
	const section = new Uint16Array(frames);
	let s = 0;
	for (let i = 0; i < frames; i++) {
		while (s < cuts.length && cuts[s] <= i) s++;
		section[i] = s;
	}

	return {
		frames,
		duration: song.duration,
		kick,
		bass,
		mid,
		high,
		energy,
		presence: energy.map((e) => Math.min(1, e / FULL_PRESENCE)),
		drift,
		flash,
		snap,
		section,
		sections: rollSections(cuts.length + 1, look),
		cuts,
		onsets,
	};
}

export function samplePulsar(table: PulsarTable, t: number): PulsarFrame {
	const frame = Math.max(0, Math.min(table.frames - 1, Math.floor(t * FPS)));
	const section = table.sections[table.section[frame]];
	const snapped = table.snap[frame] === 1;
	return {
		kick: sampleAt(table.kick, t),
		bass: sampleAt(table.bass, t),
		mid: sampleAt(table.mid, t),
		high: sampleAt(table.high, t),
		energy: sampleAt(table.energy, t),
		presence: sampleAt(table.presence, t),
		drift: sampleAt(table.drift, t),
		flash: sampleAt(table.flash, t),
		section,
		mode: !snapped
			? section.mode
			: section.mode === Mode.Ink
				? Mode.Dark
				: Mode.Ink,
	};
}
