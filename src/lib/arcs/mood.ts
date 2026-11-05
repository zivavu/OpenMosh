// What makes one section of the song look unlike the last: its shape, its camera shot
// and the arcs it favours. Rolled from the seed and the section's number alone.

import { mulberry32 } from "../rng";
import type { ControlFrame } from "./controls";

export const PATTERN_COUNT = 6;
export const STROKE_COUNT = 4;

const FOLDS = [3, 4, 5, 6, 8];
const STRETCHES: [number, number, number][] = [
	[1.5, 0.35, 1.5],
	[0.6, 1.8, 0.6],
	[2, 0.6, 0.6],
	[1.3, 1.3, 0.3],
];
const SHOTS = [2.1, 2.8, 3.5, 4.8];

export interface Mood {
	pattern: number;
	stroke: number;
	/** How strongly the knot's coils line up into one plane. */
	knotAlign: number;
	/** Stretch on x, y, z, then how many mirrored wedges the form folds into. */
	shape: [number, number, number, number];
	warpFreq: number;
	warp: number;
	dist: number;
	pitch: number;
	roll: number;
	yaw: number;
}

export function moodOf(seed: number, section: number, variety: number): Mood {
	const rng = mulberry32(
		(Math.imul(seed + 1, 40503) ^ Math.imul(section + 1, 2654435761)) >>> 0,
	);
	const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
	const toward = (neutral: number, rolled: number) =>
		neutral + (rolled - neutral) * variety;
	const rolled = {
		pattern: Math.floor(rng() * PATTERN_COUNT),
		stroke: Math.floor(rng() * STROKE_COUNT),
		knotAlign: rng(),
		folded: rng() < 0.55,
		fold: pick(FOLDS),
		stretched: rng() < 0.5,
		stretch: pick(STRETCHES),
		warpFreq: 1.5 + rng() * 3.5,
		warp: 0.4 + rng(),
		dist: pick(SHOTS),
		pitch: (rng() - 0.5) * 1.2,
		roll: (rng() - 0.5) * 1,
		yaw: rng() * Math.PI * 2,
		gate: rng(),
	};
	const on = rolled.gate < variety;
	const stretch = rolled.stretched && on ? rolled.stretch : [1, 1, 1];
	return {
		pattern: on ? rolled.pattern : 0,
		stroke: on ? rolled.stroke : 0,
		knotAlign: toward(0, rolled.knotAlign),
		shape: [
			stretch[0],
			stretch[1],
			stretch[2],
			rolled.folded && on ? rolled.fold : 1,
		],
		warpFreq: toward(2, rolled.warpFreq),
		warp: toward(0.6, rolled.warp),
		dist: toward(3.5, rolled.dist),
		pitch: toward(0, rolled.pitch),
		roll: toward(0, rolled.roll),
		yaw: toward(0, rolled.yaw),
	};
}

/** The section's mood, eased in from the last one's over a form change. The shapes stay
 * apart: each belongs to its own form. */
export function moodAt(frame: ControlFrame, seed: number, variety: number) {
	const a = moodOf(seed, frame.sectionA, variety);
	const b = moodOf(seed, frame.sectionB, variety);
	const m = frame.formMix;
	const mix = (x: number, y: number) => x + (y - x) * m;
	return {
		// The new section's arcs start as soon as it does.
		current: b,
		shapeA: a.shape,
		shapeB: b.shape,
		warpFreq: mix(a.warpFreq, b.warpFreq),
		warp: mix(a.warp, b.warp),
		dist: mix(a.dist, b.dist),
		pitch: mix(a.pitch, b.pitch),
		roll: mix(a.roll, b.roll),
		yaw: mix(a.yaw, b.yaw),
	};
}
