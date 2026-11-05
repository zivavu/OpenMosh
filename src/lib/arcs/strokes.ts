// arcDrawer's stroke (`paintStroke`), fired by the song: a walk whose steps keep a share
// of the last one's momentum, thinning as it goes. Seeded per event rather than by
// Math.random, so an arc is a function of the timestamp like the rest of the picture.

import type { Mat4 } from "../mesh/mat4";
import { mulberry32, type Rand } from "../rng";
import { sampleControls, type ControlFrame, type Controls } from "./controls";
import type { Look } from "./look";
import { moodOf, PATTERN_COUNT, STROKE_COUNT, type Mood } from "./mood";

/** Per vertex: x, y in clip space, then in pixels the distance across the arc, its half
 * width and its halo, then heat. */
export const ARC_FLOATS = 6;
const MAX_SEGMENTS = 12000;
export const MAX_ARC_VERTICES = MAX_SEGMENTS * 6;
const MAX_ARCS = 4000;
const MAX_STEPS = 80;

const TAU = Math.PI * 2;
const KICK_LIFE = [0.35, 0.7] as const;
const KICK_GROW = 0.09;
/** A spiral volley fires its arcs one after another over this long. */
const SPIRAL_DELAY = 0.18;
const CRACKLE_RATE = 24;
const CRACKLE_LIFE = 0.18;
const CRACKLE_GROW = 0.04;
const STEM_PERIOD = [1.6, 3] as const;
const KNOT_STEPS = 18;
const KNOT_PERIOD = [0.8, 2.2] as const;
/** Arcs leave from around the knot; all starting at one point would pile up into a star. */
const ORIGIN_RADIUS = 0.14;
/** Steps an arc takes to reach full heat, so its start doesn't flare either. */
const HEAT_IN_STEPS = 2.5;
/** Hot heads are what the glints catch; the bodies stay under their threshold. */
const HEAD_HEAT = 4;
const HEAD_STEPS = 3;
const HALO_REACH = 3;
/** The knot's lines stay crisp, or they melt into a ball. */
const KNOT_HALO = 0.25;
const SUBARC_HALO = 0.7;
const MIN_HEAT = 0.02;
const NEAR_W = 0.5;
/** How much closer than the focus an arc may swell, or it fills the frame. */
const MAX_NEAR_SWELL = 2.5;
const MIN_SUB_SPEED = 0.05;

type Vec = [number, number, number];

interface Stroke {
	momentum: number;
	wander: number;
	curl: number;
	push: number;
}

interface Arc extends Omit<Stroke, "push"> {
	seed: number;
	origin: Vec;
	velocity: Vec;
	/** What the walk curls around, and how far per step. */
	axis: Vec;
	steps: number;
	/** Visible span, in steps along the walk. */
	head: number;
	tail: number;
	heat: number;
	width: number;
	/** Share of the Blur knob's halo. */
	halo: number;
	/** How much of `HEAD_HEAT` its head gets. */
	spark: number;
	depth: number;
	/** Turns the whole finished walk: what makes a symmetric volley's copies. */
	turn: { axis: Vec; angle: number } | null;
}

function arcSeed(seed: number, kind: number, event: number, index: number) {
	return (
		(Math.imul(seed, 73856093) ^
			Math.imul(kind + 1, 19349663) ^
			Math.imul(event + 1, 83492791) ^
			Math.imul(index + 1, 2654435761)) >>>
		0
	);
}

function smoothstep(a: number, b: number, x: number) {
	const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return k * k * (3 - 2 * k);
}

function scale(v: Vec, k: number): Vec {
	return [v[0] * k, v[1] * k, v[2] * k];
}

function cross(a: Vec, b: Vec): Vec {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function normalize(v: Vec): Vec {
	return scale(v, 1 / (Math.hypot(v[0], v[1], v[2]) || 1));
}

function randomUnit(rng: Rand): Vec {
	const z = rng() * 2 - 1;
	const a = rng() * TAU;
	const r = Math.sqrt(1 - z * z);
	return [Math.cos(a) * r, Math.sin(a) * r, z];
}

function perpendicular(n: Vec, rng: Rand): Vec {
	return normalize(cross(n, randomUnit(rng)));
}

function rotate(v: Vec, axis: Vec, angle: number): Vec {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const k = cross(axis, v);
	const d = (axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]) * (1 - c);
	return [
		v[0] * c + k[0] * s + axis[0] * d,
		v[1] * c + k[1] * s + axis[1] * d,
		v[2] * c + k[2] * s + axis[2] * d,
	];
}

/** Four characters for the same walk, reached by moving the stroke's own settings. */
function strokeOf(kind: number, rng: Rand, look: Look): Stroke {
	const { arcMomentum: m, arcWander: w, variety } = look;
	const curlRoll = rng();
	const rolled: Stroke =
		kind === 0
			? // Whip: one long sweep.
				{
					momentum: Math.min(0.97, m + 0.1),
					wander: w * 0.5,
					curl: 0.02 + curlRoll * 0.04,
					push: 1,
				}
			: kind === 1
				? // Jag: lightning.
					{ momentum: m * 0.55, wander: w * 2.2, curl: 0, push: 1.5 }
				: kind === 2
					? // Coil: a tightening spiral.
						{
							momentum: Math.min(0.97, m + 0.08),
							wander: w * 0.4,
							curl: 0.3 + curlRoll * 0.4,
							push: 1.4,
						}
					: // Sweep: a clean curve.
						{
							momentum: Math.min(0.97, m + 0.05),
							wander: w * 0.6,
							curl: 0.08 + curlRoll * 0.12,
							push: 1,
						};
	const toward = (from: number, to: number) => from + (to - from) * variety;
	const momentum = toward(m, rolled.momentum);
	return {
		momentum,
		wander: toward(w, rolled.wander),
		curl: toward(0, rolled.curl),
		// A push travels push / (1 - momentum), so more momentum needs less of it to
		// land in the same place. Otherwise a whip flies off past the camera.
		push: toward(1, rolled.push) * ((1 - momentum) / (1 - m)),
	};
}

function lived(age: number, life: number, grow: number, steps: number) {
	const x = Math.min(1, age / grow);
	return {
		head: steps * (1 - (1 - x) ** 3),
		tail: steps * smoothstep(0.45, 1, age / life),
		fade: (1 - age / life) ** 1.2,
	};
}

/** The tangle at the middle: coils that close around the centre, with no point for
 * the light to pile up on. A kick snaps some of them to a new shape. */
function collectKnot(arcs: Arc[], frame: ControlFrame, mood: Mood, look: Look) {
	const kickNear = Math.exp(-frame.kickAge * 6);
	const radius = (0.2 + 0.45 * frame.bass + 0.35 * kickNear) * look.arcReach;
	const spin = (frame.t * 0.25 + frame.energyTotal * 1.4) * look.coreSpin;
	const shared = randomUnit(
		mulberry32(arcSeed(look.seed, 3, frame.sectionB, 0)),
	);
	for (let s = 0; s < Math.round(look.arcCore); s++) {
		const slot = mulberry32(arcSeed(look.seed, 3, s, 1));
		const period = KNOT_PERIOD[0] + slot() * (KNOT_PERIOD[1] - KNOT_PERIOD[0]);
		const clock = frame.t / period + slot();
		const beats = Math.floor((frame.onsetIndex + s) / (1 + (s % 3)));
		const epoch = Math.floor(clock);
		const id = arcSeed(look.seed, 3, s + 2, epoch * 7919 + beats);
		const rng = mulberry32(id);
		const heat =
			Math.sin((clock - epoch) * Math.PI) ** 0.5 *
			frame.energy *
			(0.8 + 0.6 * kickNear);
		const own = randomUnit(rng);
		const n = normalize([
			own[0] + (shared[0] - own[0]) * mood.knotAlign,
			own[1] + (shared[1] - own[1]) * mood.knotAlign,
			own[2] + (shared[2] - own[2]) * mood.knotAlign,
		]);
		const reach = radius * (0.35 + 0.65 * rng());
		const curl = 0.35 + rng() * 0.5;
		const origin = scale(perpendicular(n, rng), reach);
		arcs.push({
			seed: id,
			origin,
			velocity: scale(cross(n, origin), curl),
			axis: n,
			curl,
			momentum: 0.96,
			wander: look.arcWander * 0.25,
			steps: KNOT_STEPS,
			head: KNOT_STEPS,
			tail: 0,
			heat,
			width: 0.8,
			halo: KNOT_HALO,
			spark: 0,
			depth: 0,
			turn: { axis: shared, angle: spin },
		});
	}
}

function collectStems(
	arcs: Arc[],
	frame: ControlFrame,
	mood: Mood,
	steps: number,
	look: Look,
) {
	for (let s = 0; s < Math.round(look.arcStems); s++) {
		const slot = mulberry32(arcSeed(look.seed, 0, s, 0));
		const period = STEM_PERIOD[0] + slot() * (STEM_PERIOD[1] - STEM_PERIOD[0]);
		const clock = frame.t / period + slot();
		const epoch = Math.floor(clock);
		const id = arcSeed(look.seed, 0, s, epoch + 1);
		const rng = mulberry32(id);
		const dir = randomUnit(rng);
		const stroke = strokeOf(mood.stroke, rng, look);
		arcs.push({
			seed: id,
			origin: scale(dir, ORIGIN_RADIUS),
			velocity: scale(
				dir,
				(0.1 + 0.24 * frame.bass) * look.arcReach * stroke.push,
			),
			axis: perpendicular(dir, rng),
			curl: stroke.curl,
			momentum: stroke.momentum,
			wander: stroke.wander,
			steps,
			head: steps,
			tail: 0,
			heat: Math.sin((clock - epoch) * Math.PI) ** 0.6 * frame.energy * 1.2,
			width: 1,
			halo: 1,
			spark: 1,
			depth: 0,
			turn: null,
		});
	}
}

/** One hit's arcs. Each volley rolls its own layout, stroke and size, so no two kicks
 * land alike; it leans towards what the section favours. */
function collectVolley(
	arcs: Arc[],
	o: number,
	age: number,
	controls: Controls,
	steps: number,
	look: Look,
) {
	const strength = controls.onsetStrength[o];
	const mood = moodOf(
		look.seed,
		controls.sectionB[controls.onsets[o]],
		look.variety,
	);
	const rng = mulberry32(arcSeed(look.seed, 1, o, 0));
	const toward = (rolled: number) => 1 + (rolled - 1) * look.variety;
	const rolled = {
		gate: rng(),
		leans: rng() < 0.55,
		pattern: Math.floor(rng() * PATTERN_COUNT),
		stroke: Math.floor(rng() * STROKE_COUNT),
		reach: toward(0.55 + rng() * 1.15),
		count: toward(0.5 + rng() * 1.1),
		length: toward(0.6 + rng() * 0.8),
		width: toward(0.7 + rng() * 0.7),
	};
	const on = rolled.gate < look.variety;
	const pattern = !on ? 0 : rolled.leans ? mood.pattern : rolled.pattern;
	const strokeKind = rolled.leans ? mood.stroke : rolled.stroke;
	const axis = randomUnit(rng);
	const side = perpendicular(axis, rng);
	const count = Math.round(look.arcKick * (0.4 + strength) * rolled.count);
	const volleySteps = Math.min(MAX_STEPS, Math.round(steps * rolled.length));
	const symmetric = pattern >= 4;
	const shared = arcSeed(look.seed, 1, o, 1);

	for (let i = 0; i < count; i++) {
		const own = arcSeed(look.seed, 1, o, i + 2);
		const a = mulberry32(own);
		const life = KICK_LIFE[0] + a() * (KICK_LIFE[1] - KICK_LIFE[0]);
		const born = pattern === 5 ? (i / count) * SPIRAL_DELAY : 0;
		const arcAge = age - born;
		if (arcAge < 0 || arcAge >= life) continue;

		const id = symmetric ? shared : own;
		const walkRng = mulberry32(id ^ 0x5bd1e995);
		const stroke = strokeOf(strokeKind, walkRng, look);
		let dir: Vec;
		if (pattern === 0) dir = randomUnit(a);
		else if (pattern <= 2) {
			const flip = pattern === 2 && i % 2 ? -1 : 1;
			dir = rotate(scale(axis, flip), perpendicular(axis, a), a() * 0.5);
		} else if (pattern === 3) {
			dir = normalize(rotate(side, axis, a() * TAU));
		} else {
			// Flower and spiral: one walk, turned into copies around the axis.
			dir = normalize([
				side[0] + axis[0] * 0.25,
				side[1] + axis[1] * 0.25,
				side[2] + axis[2] * 0.25,
			]);
		}
		const { head, tail, fade } = lived(arcAge, life, KICK_GROW, volleySteps);
		arcs.push({
			seed: id,
			origin: scale(dir, ORIGIN_RADIUS),
			velocity: scale(
				dir,
				(0.16 + 0.2 * strength) * look.arcReach * rolled.reach * stroke.push,
			),
			axis: symmetric ? axis : perpendicular(dir, walkRng),
			curl: stroke.curl,
			momentum: stroke.momentum,
			wander: stroke.wander,
			steps: volleySteps,
			head,
			tail,
			heat: 0.75 * strength * fade,
			width: rolled.width,
			halo: 1,
			spark: 1,
			depth: 0,
			turn: symmetric ? { axis, angle: (TAU * i) / count } : null,
		});
	}
}

function collectCrackle(
	arcs: Arc[],
	t: number,
	controls: Controls,
	steps: number,
	look: Look,
) {
	const newest = Math.floor(t * CRACKLE_RATE);
	const oldest = Math.ceil((t - CRACKLE_LIFE) * CRACKLE_RATE);
	const crackleSteps = Math.ceil(steps * 0.4);
	for (let tick = newest; tick >= Math.max(0, oldest); tick--) {
		const born = tick / CRACKLE_RATE;
		const { high } = sampleControls(controls, born);
		const roll = mulberry32(arcSeed(look.seed, 2, tick, 0));
		const count = Math.floor(high * look.arcCrackle * 3 + roll());
		const { head, tail, fade } = lived(
			t - born,
			CRACKLE_LIFE,
			CRACKLE_GROW,
			crackleSteps,
		);
		for (let i = 0; i < count; i++) {
			const id = arcSeed(look.seed, 2, tick, i + 1);
			const rng = mulberry32(id);
			const dir = randomUnit(rng);
			const stroke = strokeOf(Math.floor(rng() * STROKE_COUNT), rng, look);
			arcs.push({
				seed: id,
				origin: scale(dir, ORIGIN_RADIUS),
				velocity: scale(dir, 0.12 * look.arcReach * stroke.push),
				axis: perpendicular(dir, rng),
				curl: stroke.curl,
				momentum: stroke.momentum,
				wander: stroke.wander,
				steps: crackleSteps,
				head,
				tail,
				heat: 1.6 * high * fade,
				width: 0.7,
				halo: 1,
				spark: 1,
				depth: 0,
				turn: null,
			});
		}
	}
}

function collectArcs(frame: ControlFrame, controls: Controls, look: Look) {
	const arcs: Arc[] = [];
	const steps = Math.min(MAX_STEPS, Math.round(look.arcLength));
	const mood = moodOf(look.seed, frame.sectionB, look.variety);
	collectKnot(arcs, frame, mood, look);
	collectStems(arcs, frame, mood, steps, look);
	// Newest first, so a full buffer drops the volleys that are nearly gone.
	const fps = controls.frames / controls.duration;
	for (let o = controls.onsets.length - 1; o >= 0; o--) {
		const age = frame.t - controls.onsets[o] / fps;
		if (age < 0) continue;
		if (age > KICK_LIFE[1] + SPIRAL_DELAY) break;
		collectVolley(arcs, o, age, controls, steps, look);
	}
	collectCrackle(arcs, frame.t, controls, steps, look);
	return arcs;
}

const walk = new Float32Array((MAX_STEPS + 1) * 3);
const speed = new Float32Array((MAX_STEPS + 1) * 3);
const thin = new Float32Array(MAX_STEPS + 1);

/** The walk itself. Every step draws the same randoms whatever the sway, so an arc
 * writhes in place and doesn't reshuffle. */
function traceArc(arc: Arc, phase: number, decay: number) {
	const rng = mulberry32(arc.seed);
	let [x, y, z] = arc.origin;
	let [vx, vy, vz] = arc.velocity;
	const [nx, ny, nz] = arc.axis;
	const c = Math.cos(arc.curl);
	const s = Math.sin(arc.curl);
	let width = 1;
	const swayAt = rng() * TAU;
	walk[0] = x;
	walk[1] = y;
	walk[2] = z;
	speed[0] = vx;
	speed[1] = vy;
	speed[2] = vz;
	thin[0] = 1;
	for (let i = 1; i <= arc.steps; i++) {
		const sway = 0.5 + 0.5 * Math.sin(phase + swayAt + i * 0.4);
		const off = () => {
			const a0 = rng() - 0.5;
			const b0 = rng() - 0.5;
			return (a0 + (b0 - a0) * sway) * arc.wander;
		};
		const ox = off();
		const oy = off();
		const oz = off();
		x += vx + ox;
		y += vy + oy;
		z += vz + oz;
		const mx = (vx + ox) * arc.momentum;
		const my = (vy + oy) * arc.momentum;
		const mz = (vz + oz) * arc.momentum;
		const d = (nx * mx + ny * my + nz * mz) * (1 - c);
		vx = mx * c + (ny * mz - nz * my) * s + nx * d;
		vy = my * c + (nz * mx - nx * mz) * s + ny * d;
		vz = mz * c + (nx * my - ny * mx) * s + nz * d;
		width -= (width * rng() * decay) / 3;
		walk[i * 3] = x;
		walk[i * 3 + 1] = y;
		walk[i * 3 + 2] = z;
		speed[i * 3] = vx;
		speed[i * 3 + 1] = vy;
		speed[i * 3 + 2] = vz;
		thin[i] = width;
	}
}

/** Branches read off the walk just traced. A subarc starts growing once its parent's
 * head has passed the branch, and dies with the part of the parent it hangs from. */
function spawnSubarcs(arc: Arc, queue: Arc[], look: Look) {
	const rng = mulberry32(arc.seed ^ 0x9e3779b9);
	const count =
		arc.depth === 0
			? Math.round(look.arcSub)
			: Math.floor(look.arcSub * 0.6 + rng());
	for (let b = 0; b < count; b++) {
		const at = 1 + Math.floor(rng() * 0.85 * Math.max(1, arc.steps - 2));
		const stretch = 0.6 + rng() * 0.8;
		const tilt = (rng() * 0.5 + 0.5) * look.arcSubSpread;
		const pace = 0.8 + rng() * 0.6;
		const curl = arc.curl + (rng() - 0.5) * 0.3;
		const steps = Math.min(
			MAX_STEPS,
			Math.max(3, Math.round((arc.steps - at) * look.arcSubLength * stretch)),
		);
		const seed = arcSeed(arc.seed, 7, b, arc.depth);
		const offAxis = randomUnit(rng);
		const head = Math.min(steps, (arc.head - at) * 1.5);
		const tail = Math.max(0, (arc.tail - at) * 1.5);
		if (head <= tail) continue;
		const v: Vec = [speed[at * 3], speed[at * 3 + 1], speed[at * 3 + 2]];
		const size = Math.hypot(v[0], v[1], v[2]);
		const dir: Vec = size > 1e-5 ? scale(v, 1 / size) : offAxis;
		const turnAround = normalize(cross(dir, offAxis));
		queue.push({
			seed,
			origin: [walk[at * 3], walk[at * 3 + 1], walk[at * 3 + 2]],
			velocity: scale(
				rotate(dir, turnAround, tilt),
				Math.max(size, MIN_SUB_SPEED) * pace,
			),
			axis: turnAround,
			curl,
			momentum: arc.momentum,
			wander: arc.wander,
			steps,
			head,
			tail,
			heat: arc.heat * 0.65,
			width: arc.width * thin[at] * 0.8,
			halo: arc.halo * SUBARC_HALO,
			spark: arc.spark * 0.5,
			depth: arc.depth + 1,
			turn: arc.turn,
		});
	}
}

// The visible part of the walk on screen, in pixels.
const line = new Float32Array((MAX_STEPS + 3) * 4);

function projectSpan(
	arc: Arc,
	vp: Mat4,
	w: number,
	h: number,
	pxWidth: number,
	focus: number,
): number {
	let n = 0;
	const put = (step: number) => {
		const i = Math.floor(step);
		const j = Math.min(arc.steps, i + 1);
		const f = step - i;
		const lerp = (o: number) =>
			walk[i * 3 + o] + (walk[j * 3 + o] - walk[i * 3 + o]) * f;
		let p: Vec = [lerp(0), lerp(1), lerp(2)];
		if (arc.turn) p = rotate(p, arc.turn.axis, arc.turn.angle);
		const [x, y, z] = p;
		const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
		if (cw < NEAR_W) return false;
		const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
		const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
		line[n * 4] = (cx / cw) * 0.5 * w;
		line[n * 4 + 1] = (cy / cw) * 0.5 * h;
		line[n * 4 + 2] =
			pxWidth *
			arc.width *
			(thin[i] + (thin[j] - thin[i]) * f) *
			Math.min(MAX_NEAR_SWELL, focus / cw);
		line[n * 4 + 3] = step;
		n++;
		return true;
	};
	if (!put(arc.tail)) return n;
	for (let s = Math.floor(arc.tail) + 1; s < arc.head; s++) {
		if (!put(s)) return n;
	}
	if (arc.head > arc.tail) put(arc.head);
	return n;
}

/** Fills `out` with this moment's arcs as triangles; returns the vertex count. */
export function buildArcs(
	out: Float32Array,
	frame: ControlFrame,
	controls: Controls,
	look: Look,
	viewProj: Mat4,
	focus: number,
	w: number,
	h: number,
): number {
	if (look.arcAmount <= 0) return 0;
	const side = Math.sqrt(w * h) / 960;
	const pxWidth = look.arcWidth * side;
	const glow = Math.max(0.5, look.arcGlow * side);
	const phase = (frame.t * 1.2 + frame.energyTotal * 1.5) * look.arcWrithe;
	const depthLimit = look.arcSub >= 1 ? Math.round(look.arcSubDepth) : 0;
	let at = 0;
	let vertices = 0;
	const vertex = (
		x: number,
		y: number,
		across: number,
		halfWidth: number,
		halo: number,
		heat: number,
	) => {
		out[at++] = x / (w * 0.5);
		out[at++] = y / (h * 0.5);
		out[at++] = across;
		out[at++] = halfWidth;
		out[at++] = halo;
		out[at++] = heat;
		vertices++;
	};

	const queue = collectArcs(frame, controls, look);
	for (let q = 0; q < queue.length; q++) {
		const arc = queue[q];
		const heat = arc.heat * look.arcAmount;
		if (heat < MIN_HEAT || arc.head <= arc.tail) continue;
		traceArc(arc, phase, look.arcDecay);
		if (arc.depth < depthLimit && queue.length < MAX_ARCS) {
			spawnSubarcs(arc, queue, look);
		}
		const n = projectSpan(arc, viewProj, w, h, pxWidth, focus);
		const heatAt = (k: number) => {
			const step = line[k * 4 + 3];
			const toHead = (arc.head - step) / HEAD_STEPS;
			return (
				heat *
				Math.min(1, (step + 0.3) / HEAT_IN_STEPS) *
				(1 + HEAD_HEAT * arc.spark * Math.max(0, 1 - toHead))
			);
		};
		const corner = (k: number, s: { x: number; y: number }, sign: number) => {
			const width = line[k * 4 + 2];
			const halo = glow * arc.halo;
			const reach = width + halo * HALO_REACH;
			vertex(
				line[k * 4] + s.x * reach * sign,
				line[k * 4 + 1] + s.y * reach * sign,
				reach * sign,
				width,
				halo,
				heatAt(k),
			);
		};
		for (let i = 0; i + 1 < n; i++) {
			if (vertices + 6 > MAX_ARC_VERTICES) return vertices;
			const side0 = sideAt(i, n);
			const side1 = sideAt(i + 1, n);
			corner(i, side0, 1);
			corner(i, side0, -1);
			corner(i + 1, side1, 1);
			corner(i + 1, side1, 1);
			corner(i, side0, -1);
			corner(i + 1, side1, -1);
		}
	}
	return vertices;
}

/** The ribbon's sideways direction at a point, between its two neighbours. */
function sideAt(i: number, n: number) {
	const a = Math.max(0, i - 1);
	const b = Math.min(n - 1, i + 1);
	const dx = line[b * 4] - line[a * 4];
	const dy = line[b * 4 + 1] - line[a * 4 + 1];
	const len = Math.hypot(dx, dy) || 1;
	return { x: -dy / len, y: dx / len };
}
