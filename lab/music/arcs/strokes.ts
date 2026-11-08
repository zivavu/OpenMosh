// arcDrawer's stroke (`paintStroke`), laid along a figure by the song: a walk whose steps
// keep a share of the last one's momentum, thinning as it goes, stamped as one capsule per
// segment. Seeded rather than by Math.random, so a stroke is a function of the timestamp
// like the rest of the picture.

import { mulberry32 } from "../../../src/lib/rng";
import type { ControlFrame, Controls } from "./controls";
import {
	figureOf,
	type Copy,
	type Extent,
	type Figure,
	type Hair,
} from "./figures";
import type { Look } from "./look";

/** Per vertex, in pixels from the frame's middle: the corner, the segment's two ends and
 * its half width at each. */
export const ARC_FLOATS = 8;
/** Per stroke: first vertex, vertex count, opacity, palette position, then its box in
 * pixels from the frame's corner: x0, y0, x1, y1. */
export const STROKE_FLOATS = 8;
const MAX_SEGMENTS = 24000;
export const MAX_ARC_VERTICES = MAX_SEGMENTS * 6;
const MAX_STEPS = 32;
export const MAX_STROKES = 1200;
/** Curve samples per walk step, so a stroke bends instead of kinking. */
const SUBSTEPS = 2;

const TAU = Math.PI * 2;
const GROW_SECONDS = 0.2;
const BLUR_REACH = 3;
/** arcDrawer's pixels are read at this frame size. */
const REFERENCE_SIDE = 960;
/** Neighbouring strokes share a bend across this many of them. */
const FIELD_ROWS = 7;
/** The share of a figure that's still being erased when its last stroke starts to go. */
const ERASE_SWEEP = 0.5;
const TONE_TOP = 0.92;

const walkX = new Float32Array(MAX_STEPS + 1);
const walkY = new Float32Array(MAX_STEPS + 1);
const thin = new Float32Array(MAX_STEPS + 1);
const LINE_FLOATS = 3;
const line = new Float32Array((MAX_STEPS * SUBSTEPS + 3) * LINE_FLOATS);

function smoothstep(a: number, b: number, x: number) {
	const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return k * k * (3 - 2 * k);
}

function hash(a: number, b: number, c: number, d: number) {
	let h =
		Math.imul(a, 73856093) ^
		Math.imul(b + 1, 19349663) ^
		Math.imul(c + 1, 83492791) ^
		Math.imul(d + 1, 2654435761);
	h = Math.imul(h ^ (h >>> 15), 1 | h);
	h ^= h + Math.imul(h ^ (h >>> 7), 61 | h);
	return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

/** -0.5 to 0.5, drifting smoothly from one stroke of the figure to the next. */
function field(seed: number, step: number, salt: number, row: number) {
	const at = row / FIELD_ROWS;
	const cell = Math.floor(at);
	const k = at - cell;
	const a = hash(seed, step, salt, cell);
	const b = hash(seed, step, salt, cell + 1);
	return a + (b - a) * k * k * (3 - 2 * k) - 0.5;
}

/** The walk itself, in arcDrawer's pixels from the stroke's start. Every step draws the
 * same randoms whatever the sway, so a stroke writhes in place and doesn't reshuffle. */
function traceWalk(
	figure: Figure,
	hair: Hair,
	steps: number,
	look: Look,
	phase: number,
	swayDepth: number,
) {
	const rng = mulberry32(figure.seed ^ Math.imul(hair.row + 1, 2654435761));
	const swayAt = rng() * TAU;
	const { arcWander: wander, arcMomentum: momentum, arcJitter: jitter } = look;
	const offset = (step: number, salt: number, sway: number) => {
		const own = rng() - 0.5;
		const other = rng() - 0.5;
		const shared = field(figure.seed, step, salt, hair.row);
		const kept = shared + (own - shared) * jitter;
		const moved = field(figure.seed, step, salt + 2, hair.row);
		const away = moved + (other - moved) * jitter;
		return (kept + (away - kept) * sway) * wander;
	};
	let x = 0;
	let y = 0;
	let width = 1;
	// arcDrawer's strokes start with no momentum. A little here is what combs them into
	// the figure's shape.
	let vx = hair.lean[0] * wander * look.arcComb;
	let vy = hair.lean[1] * wander * look.arcComb;
	walkX[0] = 0;
	walkY[0] = 0;
	thin[0] = 1;
	for (let i = 1; i <= steps; i++) {
		const sway = 0.5 + 0.5 * swayDepth * Math.sin(phase + swayAt + i * 0.4);
		const ox = offset(i, 0, sway);
		const oy = offset(i, 1, sway);
		x += vx + ox;
		y += vy + oy;
		vx = (vx + ox) * momentum;
		vy = (vy + oy) * momentum;
		width -= (width * rng() * look.arcDecay) / 3;
		walkX[i] = x;
		walkY[i] = y;
		thin[i] = width;
	}
}

function catmullRom(p: Float32Array, i: number, f: number, last: number) {
	const a = p[Math.max(0, i - 1)];
	const b = p[i];
	const c = p[Math.min(last, i + 1)];
	const d = p[Math.min(last, i + 2)];
	return (
		b +
		0.5 *
			f *
			(c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)))
	);
}

/** The visible part of the walk, smoothed: x, y, thinness. */
function sampleSpan(steps: number, tail: number, head: number, scale: number) {
	let n = 0;
	const put = (at: number) => {
		const i = Math.min(steps - 1, Math.floor(at));
		const f = at - i;
		line[n * LINE_FLOATS] = catmullRom(walkX, i, f, steps) * scale;
		line[n * LINE_FLOATS + 1] = catmullRom(walkY, i, f, steps) * scale;
		line[n * LINE_FLOATS + 2] = thin[i] + (thin[i + 1] - thin[i]) * f;
		n++;
	};
	put(tail);
	const first = Math.floor(tail * SUBSTEPS) + 1;
	for (let k = first; k / SUBSTEPS < head; k++) put(k / SUBSTEPS);
	put(head);
	return n;
}

/** The frame on the song's clock when the pen reached this place in the section. */
function bornFrame(pen: Float32Array, from: number, to: number, at: number) {
	let lo = from;
	let hi = to;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (pen[mid] < at) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function sectionRange(c: Controls, section: number, now: number) {
	const from = section > 0 ? c.cuts[section - 1] : 0;
	const to = c.cuts[section] ?? c.frames - 1;
	return { from: Math.min(from, now), to: Math.min(to, c.frames - 1) };
}

export interface BuiltArcs {
	vertices: number;
	strokes: number;
}

/** Fills `out` with this moment's capsules and `table` with the strokes they belong to,
 * in the order they paint. */
export function buildArcs(
	out: Float32Array,
	table: Float32Array,
	frame: ControlFrame,
	controls: Controls,
	look: Look,
	w: number,
	h: number,
): BuiltArcs {
	const built: BuiltArcs = { vertices: 0, strokes: 0 };
	const presence = frame.presence * look.arcOpacity;
	if (presence <= 0) return built;
	const px = Math.sqrt(w * h) / REFERENCE_SIDE;
	const halfShort = Math.min(w, h) / 2;
	const extent: Extent = { x: w / 2 / halfShort, y: h / 2 / halfShort };
	const phase = frame.t * 1.2 + frame.energyTotal * 1.5;
	const swayDepth = Math.min(
		1,
		look.arcWrithe * (0.35 + frame.mid * look.midWrithe),
	);
	const pulse = 1 + look.kickReach * frame.kick + look.bassReach * frame.bass;
	const swell = 1 + look.kickWidth * frame.kick;
	const steps = Math.min(MAX_STEPS, Math.round(look.arcLength));
	const hairs = Math.round(look.arcHairs);
	const blurReach = look.arcBlur * px * BLUR_REACH;
	const fps = controls.frames / controls.duration;
	const nowFrame = Math.min(controls.frames - 1, Math.floor(frame.t * fps));
	const unit = halfShort * look.arcSize;

	let at = 0;
	const stamp = (
		sx: number,
		sy: number,
		ax: number,
		ay: number,
		bx: number,
		by: number,
		r0: number,
		r1: number,
	) => {
		out[at++] = sx;
		out[at++] = sy;
		out[at++] = ax;
		out[at++] = ay;
		out[at++] = bx;
		out[at++] = by;
		out[at++] = r0;
		out[at++] = r1;
		built.vertices++;
	};

	/** One copy of the sampled line, each segment a box round its capsule. */
	const emitStroke = (
		[a, b, c, d, e, f]: Copy,
		hair: Hair,
		n: number,
		width: number,
		alpha: number,
		tone: number,
	) => {
		const first = built.vertices;
		const startX = hair.x * unit;
		const startY = hair.y * unit;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let x0 = 0;
		let y0 = 0;
		for (let k = 0; k < n; k++) {
			const lx = startX + line[k * LINE_FLOATS];
			const ly = startY + line[k * LINE_FLOATS + 1];
			const x1 = a * lx + b * ly + e * unit;
			const y1 = c * lx + d * ly + f * unit;
			const r1 = width * line[k * LINE_FLOATS + 2];
			const pad1 = r1 + blurReach;
			minX = Math.min(minX, x1 - pad1);
			minY = Math.min(minY, y1 - pad1);
			maxX = Math.max(maxX, x1 + pad1);
			maxY = Math.max(maxY, y1 + pad1);
			if (k > 0) {
				const r0 = width * line[(k - 1) * LINE_FLOATS + 2];
				const pad = Math.max(r0, r1) + blurReach;
				const length = Math.hypot(x1 - x0, y1 - y0) || 1;
				const tx = ((x1 - x0) / length) * pad;
				const ty = ((y1 - y0) / length) * pad;
				const corner = (u: number, v: number) =>
					stamp(
						(u > 0 ? x1 + tx : x0 - tx) - ty * v,
						(u > 0 ? y1 + ty : y0 - ty) + tx * v,
						x0,
						y0,
						x1,
						y1,
						r0,
						r1,
					);
				corner(-1, -1);
				corner(1, -1);
				corner(-1, 1);
				corner(-1, 1);
				corner(1, -1);
				corner(1, 1);
			}
			x0 = x1;
			y0 = y1;
		}
		const row = built.strokes++ * STROKE_FLOATS;
		table[row] = first;
		table[row + 1] = built.vertices - first;
		table[row + 2] = alpha;
		table[row + 3] = tone;
		table[row + 4] = minX + w / 2;
		table[row + 5] = minY + h / 2;
		table[row + 6] = maxX + w / 2;
		table[row + 7] = maxY + h / 2;
	};

	const drawSection = (section: number, pen: number, erase: number) => {
		const figure = figureOf(look.seed, section, extent, hairs, look.arcHue);
		const { from, to } = sectionRange(controls, section, nowFrame);
		for (const hair of figure.hairs) {
			if (hair.pen > pen) continue;
			const born = bornFrame(controls.pen, from, to, hair.pen);
			const grown = Math.max(
				0,
				Math.min(1, (frame.t - born / fps) / GROW_SECONDS),
			);
			const gone = smoothstep(
				hair.pen * ERASE_SWEEP,
				hair.pen * ERASE_SWEEP + 1 - ERASE_SWEEP,
				erase,
			);
			const head = steps * (1 - (1 - grown) ** 3);
			const tail = steps * gone;
			if (gone >= 1 || head <= tail + 1e-3) continue;
			traceWalk(figure, hair, steps, look, phase, swayDepth);
			const pressure = 1 + look.kickPressure * (controls.kick[born] - 0.5);
			const reach = look.arcReach * hair.reach * pressure * pulse * px;
			const n = sampleSpan(steps, tail, head, reach);
			const width = (look.arcWidth / 2) * px * pressure * swell;
			for (const copy of figure.copies) {
				if (
					built.strokes >= MAX_STROKES ||
					built.vertices + n * 6 > MAX_ARC_VERTICES
				) {
					return false;
				}
				emitStroke(
					copy,
					hair,
					n,
					width,
					presence * (1 - gone),
					TONE_TOP + hair.tone,
				);
			}
		}
		return true;
	};

	// The arriving figure first: a full buffer gives up the one that's going.
	const room = drawSection(frame.sectionB, controls.pen[nowFrame], 0);
	if (room && frame.sectionA !== frame.sectionB) {
		drawSection(frame.sectionA, 1, frame.morph);
	}
	return built;
}
