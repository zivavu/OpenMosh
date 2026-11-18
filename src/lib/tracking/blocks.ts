import { mulberry32 } from "../rng";
import type { BlockFill, TrackingParams } from "./types";

/** Blocks look: boxes over the picture's brightest, moving or most detailed
 * spots, at several sizes. Large boxes stack over dense areas into stepped
 * shapes and small ones scatter over stray detail, the way blob trackers
 * box fireworks. */

export const MAX_BLOCKS = 96;
export const MAX_LINKS = 24;
/** Data texture: row 0 rects, row 1 block info. */
export const BLOCKS_TEX_W = MAX_BLOCKS;
export const BLOCKS_TEX_H = 2;
/** Points along each link's curve. */
export const LINK_SEGMENTS = 32;
/** Per ribbon vertex: x, y (normalized, y from the top), px across the
 * centreline, half width in px, alpha. */
export const RIBBON_FLOATS = 5;
export const RIBBON_MAX_FLOATS = MAX_LINKS * LINK_SEGMENTS * 6 * RIBBON_FLOATS;

/** The shader's fill index; Mix (-1) lets each block keep its own. */
export const BLOCK_FILLS: Record<BlockFill, number> = {
	invert: 0,
	heat: 1,
	hue: 2,
	mix: -1,
};

export interface BlockRect {
	/** Normalized, y from the top. */
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** 0 is the largest size. */
	level: number;
}

export interface Block extends BlockRect {
	id: number;
	/** Drawn rect, eased toward the target one. */
	dx0: number;
	dy0: number;
	dx1: number;
	dy1: number;
	/** Fill used by Mix, 0..2. */
	style: number;
	outline: number;
}

export interface BlockLink {
	a: number;
	b: number;
	/** Where on each block the curve is pinned, 0..1 across it. */
	au: number;
	av: number;
	bu: number;
	bv: number;
	/** The two control points' pull off the chord, as shares of its length.
	 * Same sign bows the curve; opposite signs make an S. */
	bend1: number;
	bend2: number;
	/** 0..1, offsets the slow sway so no two curves move together. */
	phase: number;
	alpha: number;
	/** Animation time it started drawing itself in. */
	born: number;
}

export interface BlocksState {
	blocks: Block[];
	links: BlockLink[];
	prevMean: Float32Array | null;
	lastTick: number;
	lastEase: number;
	nextId: number;
}

export function newBlocksState(): BlocksState {
	return {
		blocks: [],
		links: [],
		prevMean: null,
		lastTick: -1,
		lastEase: -1,
		nextId: 0,
	};
}

export interface BlockGrid {
	mean: Float32Array;
	peak: Float32Array;
	gw: number;
	gh: number;
}

/** The pooled readback: RGB is each cell's mean colour, A its brightest pixel. */
export function gridFromRGBA(
	rgba: Uint8Array,
	gw: number,
	gh: number,
): BlockGrid {
	const n = gw * gh;
	const mean = new Float32Array(n);
	const peak = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const o = i * 4;
		mean[i] =
			(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
		peak[i] = rgba[o + 3] / 255;
	}
	return { mean, peak, gw, gh };
}

function hash(a: number, b: number, c = 0): number {
	let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
	h = Math.imul(h ^ ((b | 0) + 0x165667b1), 0xc2b2ae35);
	h = Math.imul(h ^ ((c | 0) + 0x27d4eb2f), 0x85ebca6b);
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}

const FLOOR = { light: 0.15, motion: 0.04, detail: 0.05 } as const;

/** 0..1 per cell: how much it holds what the blocks follow. The threshold sits
 * between the frame's average and its peak, so it adapts to the footage. */
export function activityMap(
	grid: BlockGrid,
	prevMean: Float32Array | null,
	params: TrackingParams,
): Float32Array {
	const { mean, peak, gw, gh } = grid;
	const n = gw * gh;
	const v = new Float32Array(n);
	const act = new Float32Array(n);
	if (params.follow === "light") {
		for (let i = 0; i < n; i++) v[i] = 0.5 * mean[i] + 0.5 * peak[i];
	} else if (params.follow === "motion") {
		if (!prevMean || prevMean.length !== n) return act;
		for (let i = 0; i < n; i++) v[i] = Math.abs(mean[i] - prevMean[i]);
	} else {
		for (let y = 1; y < gh - 1; y++) {
			for (let x = 1; x < gw - 1; x++) {
				const i = y * gw + x;
				v[i] =
					Math.abs(mean[i + 1] - mean[i - 1]) +
					Math.abs(mean[i + gw] - mean[i - gw]);
			}
		}
	}
	let sum = 0;
	let max = 0;
	for (let i = 0; i < n; i++) {
		sum += v[i];
		if (v[i] > max) max = v[i];
	}
	const floor = FLOOR[params.follow];
	if (max < floor) return act;
	const avg = sum / n;
	const th = Math.max(
		floor,
		avg + (max - avg) * (0.75 - 0.6 * params.sensitivity),
	);
	const soft = Math.max(0.02, (max - th) * 0.5);
	for (let i = 0; i < n; i++) {
		act[i] = Math.min(1, Math.max(0, (v[i] - th) / soft));
	}
	return act;
}

interface Level {
	scale: number;
	/** Share of the box that must be active. */
	need: number;
	/** Aspect range, width over height. */
	minAspect: number;
	maxAspect: number;
	/** Share of the block budget. */
	share: number;
}

const LEVELS: Level[] = [
	{ scale: 1, need: 0.4, minAspect: 0.75, maxAspect: 1.35, share: 0.08 },
	{ scale: 0.5, need: 0.28, minAspect: 0.4, maxAspect: 2.5, share: 0.17 },
	{ scale: 0.25, need: 0.16, minAspect: 0.3, maxAspect: 3.3, share: 0.3 },
	{ scale: 0.125, need: 0.06, minAspect: 0.25, maxAspect: 4, share: 1 },
];

/** Blocks a box rejects: too much of it already sits under a picked one. */
const SAME_LEVEL_OVERLAP = 0.35;
const CROSS_LEVEL_OVERLAP = 0.6;
const SEED = 7;

interface Candidate extends BlockRect {
	score: number;
}

/** Where the blocks go this tick, largest first. `aspect` is the frame's
 * width over height. */
export function detectBlocks(
	grid: BlockGrid,
	act: Float32Array,
	aspect: number,
	params: TrackingParams,
): BlockRect[] {
	const { gw, gh } = grid;
	const sw = gw + 1;
	const sat = new Float64Array(sw * (gh + 1));
	for (let y = 0; y < gh; y++) {
		let row = 0;
		for (let x = 0; x < gw; x++) {
			row += act[y * gw + x];
			sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + row;
		}
	}
	// Frame units: height 1, width `aspect`.
	const cw = aspect / gw;
	const ch = 1 / gh;
	const minSide = 1.5 * Math.max(cw, ch);
	const maxSide = Math.max(minSide, params.size * 2.5 * Math.min(aspect, 1));

	const picked: Candidate[] = [];
	let carry = 0;
	let lastSide = Infinity;
	for (let k = 0; k < LEVELS.length; k++) {
		const lv = LEVELS[k];
		const quota =
			k === LEVELS.length - 1
				? params.blocks - picked.length
				: Math.round(params.blocks * lv.share) + carry;
		const side = Math.max(minSide, maxSide * lv.scale);
		if (quota <= 0 || side >= lastSide) {
			carry = Math.max(0, quota);
			continue;
		}
		lastSide = side;
		const stride = side * 0.5;
		const ox = hash(SEED, k, 1) * stride;
		const oy = hash(SEED, k, 2) * stride;
		const cands: Candidate[] = [];
		const cols = Math.ceil(aspect / stride) + 1;
		const rows = Math.ceil(1 / stride) + 1;
		for (let iy = 0; iy < rows; iy++) {
			for (let ix = 0; ix < cols; ix++) {
				const seed = k * 7919 + iy * 131 + ix;
				const r1 = hash(SEED, seed, 3);
				const r2 = hash(SEED, seed, 4);
				const a = Math.exp(
					Math.log(lv.minAspect) +
						r1 * (Math.log(lv.maxAspect) - Math.log(lv.minAspect)),
				);
				const s = side * (0.75 + 0.5 * r2);
				const w = s * Math.sqrt(a);
				const h = s / Math.sqrt(a);
				const cx =
					ox + ix * stride + (hash(SEED, seed, 5) - 0.5) * stride * 0.5;
				const cy =
					oy + iy * stride + (hash(SEED, seed, 6) - 0.5) * stride * 0.5;
				const x0 = Math.max(0, cx - w / 2);
				const x1 = Math.min(aspect, cx + w / 2);
				const y0 = Math.max(0, cy - h / 2);
				const y1 = Math.min(1, cy + h / 2);
				if (x1 - x0 < w * 0.5 || y1 - y0 < h * 0.5) continue;
				const c0 = Math.max(0, Math.floor(x0 / cw));
				const c1 = Math.min(gw, Math.ceil(x1 / cw));
				const r0 = Math.max(0, Math.floor(y0 * gh));
				const rr1 = Math.min(gh, Math.ceil(y1 * gh));
				if (c1 <= c0 || rr1 <= r0) continue;
				const sum =
					sat[rr1 * sw + c1] -
					sat[r0 * sw + c1] -
					sat[rr1 * sw + c0] +
					sat[r0 * sw + c0];
				const fill = sum / ((c1 - c0) * (rr1 - r0));
				if (fill < lv.need) continue;
				cands.push({
					x0: x0 / aspect,
					x1: x1 / aspect,
					y0,
					y1,
					level: k,
					// Big blocks go where it's densest; small ones anywhere it qualifies.
					score:
						fill ** (1 - k / (LEVELS.length - 1)) *
						(0.7 + 0.3 * hash(SEED, seed, 7)),
				});
			}
		}
		cands.sort((p, q) => q.score - p.score);
		let taken = 0;
		for (const c of cands) {
			if (taken >= quota) break;
			if (buried(c, picked)) continue;
			picked.push(c);
			taken++;
		}
		carry = quota - taken;
	}
	return picked.map(({ x0, y0, x1, y1, level }) => ({ x0, y0, x1, y1, level }));
}

function buried(c: Candidate, picked: Candidate[]): boolean {
	const area = (c.x1 - c.x0) * (c.y1 - c.y0);
	for (const p of picked) {
		const ix = Math.min(c.x1, p.x1) - Math.max(c.x0, p.x0);
		if (ix <= 0) continue;
		const iy = Math.min(c.y1, p.y1) - Math.max(c.y0, p.y0);
		if (iy <= 0) continue;
		const limit =
			p.level === c.level ? SAME_LEVEL_OVERLAP : CROSS_LEVEL_OVERLAP;
		if ((ix * iy) / area > limit) return true;
	}
	return false;
}

/** Chance a block of each level gets an outline. */
const OUTLINE_CHANCE = [0, 0.35, 0.8, 0.9];

/** Carry identities over from the last tick: a new block close to an old one
 * of the same size is that block, moved, so it glides there instead of popping. */
export function trackBlocks(
	state: BlocksState,
	rects: BlockRect[],
	params: TrackingParams,
	time: number,
): void {
	const prev = state.blocks;
	const used = new Uint8Array(prev.length);
	const next: Block[] = [];
	for (const r of rects) {
		const cx = (r.x0 + r.x1) / 2;
		const cy = (r.y0 + r.y1) / 2;
		let best = -1;
		let bestD = Infinity;
		for (let j = 0; j < prev.length; j++) {
			const p = prev[j];
			if (used[j] || p.level !== r.level) continue;
			const d = Math.hypot((p.x0 + p.x1) / 2 - cx, (p.y0 + p.y1) / 2 - cy);
			const reach =
				0.6 * Math.max(p.x1 - p.x0, p.y1 - p.y0, r.x1 - r.x0, r.y1 - r.y0);
			if (d < reach && d < bestD) {
				best = j;
				bestD = d;
			}
		}
		if (best >= 0) {
			used[best] = 1;
			next.push({ ...prev[best], ...r });
			continue;
		}
		const id = state.nextId++;
		next.push({
			...r,
			id,
			dx0: r.x0,
			dy0: r.y0,
			dx1: r.x1,
			dy1: r.y1,
			style: Math.floor(hash(SEED, id, 8) * 3),
			outline: hash(SEED, id, 9) < OUTLINE_CHANCE[r.level] ? 1 : 0,
		});
	}
	state.blocks = next;
	relink(state, params, time);
}

function relink(
	state: BlocksState,
	params: TrackingParams,
	time: number,
): void {
	const blocks = state.blocks;
	const want = Math.min(
		Math.round(params.links * MAX_LINKS),
		Math.max(0, blocks.length - 1),
	);
	const alive = new Set(blocks.map((b) => b.id));
	const links = state.links.filter((l) => alive.has(l.a) && alive.has(l.b));
	links.length = Math.min(links.length, want);
	const rng = mulberry32(state.nextId * 131 + links.length);
	// Arcs start on the bigger blocks, which come first, and reach anywhere.
	const hubs = Math.min(blocks.length, 6);
	for (let tries = 0; links.length < want && tries < want * 4; tries++) {
		const a = blocks[Math.floor(rng() * hubs)].id;
		const b = blocks[Math.floor(rng() * blocks.length)].id;
		if (
			a === b ||
			links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))
		) {
			continue;
		}
		const side = rng() < 0.5 ? -1 : 1;
		const bend1 = (0.1 + rng() * 0.45) * side;
		const s = rng() < 0.45 ? -side : side;
		links.push({
			a,
			b,
			au: 0.2 + rng() * 0.6,
			av: 0.2 + rng() * 0.6,
			bu: 0.2 + rng() * 0.6,
			bv: 0.2 + rng() * 0.6,
			bend1,
			bend2: (0.05 + rng() * 0.45) * s,
			phase: rng(),
			alpha: 0.35 + rng() * 0.5,
			born: time,
		});
	}
	state.links = links;
}

/** One analysis tick: score the grid, place the blocks, carry identities over. */
export function analyzeBlocks(
	state: BlocksState,
	grid: BlockGrid,
	aspect: number,
	params: TrackingParams,
	time: number,
): void {
	const gap = state.lastTick < 0 ? Infinity : time - state.lastTick;
	const prev = gap > 0 && gap < 0.5 ? state.prevMean : null;
	const act = activityMap(grid, prev, params);
	trackBlocks(state, detectBlocks(grid, act, aspect, params), params, time);
	state.prevMean = grid.mean;
	state.lastTick = time;
}

/** Glide each drawn rect toward its target. A jump back in time snaps. */
export function easeBlocks(state: BlocksState, time: number): void {
	const dt = time - state.lastEase;
	const k =
		state.lastEase < 0 || dt < 0 || dt > 0.5 ? 1 : 1 - Math.exp(-dt * 20);
	state.lastEase = time;
	for (const b of state.blocks) {
		b.dx0 += (b.x0 - b.dx0) * k;
		b.dy0 += (b.y0 - b.dy0) * k;
		b.dx1 += (b.x1 - b.dx1) * k;
		b.dy1 += (b.y1 - b.dy1) * k;
	}
}

/** Write the blocks into `out` (BLOCKS_TEX_W x BLOCKS_TEX_H RGBA). */
export function packBlocks(state: BlocksState, out: Float32Array): number {
	const row = BLOCKS_TEX_W * 4;
	const count = Math.min(state.blocks.length, MAX_BLOCKS);
	for (let i = 0; i < count; i++) {
		const b = state.blocks[i];
		out.set([b.dx0, b.dy0, b.dx1, b.dy1], i * 4);
		out.set([b.style, b.outline, 0, 0], row + i * 4);
	}
	return count;
}

const GROW_S = 0.5;

/** Each link as a ribbon of triangles along a swaying cubic curve: it draws
 * itself in from its first block, is thickest and brightest midway and thins
 * out to both ends. Sizes are in px of a `width` x `height` frame; returns the
 * vertex count. */
export function buildLinkRibbons(
	state: BlocksState,
	width: number,
	height: number,
	lineWidth: number,
	time: number,
	out: Float32Array,
): number {
	const byId = new Map<number, Block>();
	for (const b of state.blocks) byId.set(b.id, b);
	const pts = new Float32Array((LINK_SEGMENTS + 1) * 5);
	let o = 0;
	let links = 0;
	for (const l of state.links) {
		if (links >= MAX_LINKS) break;
		const a = byId.get(l.a);
		const b = byId.get(l.b);
		if (!a || !b) continue;
		const ax = (a.dx0 + (a.dx1 - a.dx0) * l.au) * width;
		const ay = (a.dy0 + (a.dy1 - a.dy0) * l.av) * height;
		const bx = (b.dx0 + (b.dx1 - b.dx0) * l.bu) * width;
		const by = (b.dy0 + (b.dy1 - b.dy0) * l.bv) * height;
		const dx = bx - ax;
		const dy = by - ay;
		const len = Math.hypot(dx, dy);
		if (len < 2) continue;
		const nx = -dy / len;
		const ny = dx / len;
		const sway = time * 1.3 + l.phase * Math.PI * 2;
		const k1 = (l.bend1 + 0.08 * Math.sin(sway)) * len;
		const k2 = (l.bend2 + 0.08 * Math.sin(sway * 0.77 + 2)) * len;
		const p1x = ax + dx / 3 + nx * k1;
		const p1y = ay + dy / 3 + ny * k1;
		const p2x = ax + (dx * 2) / 3 + nx * k2;
		const p2y = ay + (dy * 2) / 3 + ny * k2;
		const age = (time - l.born) / GROW_S;
		const grow = age < 0 || age >= 1 ? 1 : 1 - (1 - age) ** 3;

		for (let i = 0; i <= LINK_SEGMENTS; i++) {
			const t = (grow * i) / LINK_SEGMENTS;
			const u = 1 - t;
			const x =
				u * u * u * ax +
				3 * u * u * t * p1x +
				3 * u * t * t * p2x +
				t * t * t * bx;
			const y =
				u * u * u * ay +
				3 * u * u * t * p1y +
				3 * u * t * t * p2y +
				t * t * t * by;
			let tx =
				3 * u * u * (p1x - ax) +
				6 * u * t * (p2x - p1x) +
				3 * t * t * (bx - p2x);
			let ty =
				3 * u * u * (p1y - ay) +
				6 * u * t * (p2y - p1y) +
				3 * t * t * (by - p2y);
			const tl = Math.hypot(tx, ty) || 1;
			tx /= tl;
			ty /= tl;
			const swell = Math.sin(Math.PI * t);
			const j = i * 5;
			pts[j] = x;
			pts[j + 1] = y;
			pts[j + 2] = -ty;
			pts[j + 3] = tx;
			pts[j + 4] = swell;
		}
		for (let i = 0; i < LINK_SEGMENTS; i++) {
			const p = i * 5;
			const q = p + 5;
			o = ribbonVertex(out, o, pts, p, 1, lineWidth, l.alpha, width, height);
			o = ribbonVertex(out, o, pts, p, -1, lineWidth, l.alpha, width, height);
			o = ribbonVertex(out, o, pts, q, 1, lineWidth, l.alpha, width, height);
			o = ribbonVertex(out, o, pts, q, 1, lineWidth, l.alpha, width, height);
			o = ribbonVertex(out, o, pts, p, -1, lineWidth, l.alpha, width, height);
			o = ribbonVertex(out, o, pts, q, -1, lineWidth, l.alpha, width, height);
		}
		links++;
	}
	return o / RIBBON_FLOATS;
}

function ribbonVertex(
	out: Float32Array,
	o: number,
	pts: Float32Array,
	p: number,
	side: number,
	lineWidth: number,
	alpha: number,
	width: number,
	height: number,
): number {
	const swell = pts[p + 4];
	const half = lineWidth * 0.5 * (0.3 + 0.7 * swell);
	// One px of feather past the edge for the fragment shader to fade over.
	const reach = (half + 1) * side;
	out[o] = (pts[p] + pts[p + 2] * reach) / width;
	out[o + 1] = (pts[p + 1] + pts[p + 3] * reach) / height;
	out[o + 2] = reach;
	out[o + 3] = half;
	out[o + 4] = alpha * (0.25 + 0.75 * swell);
	return o + RIBBON_FLOATS;
}
