import { mulberry32 } from "../rng";
import type { BlockFill, TrackingParams } from "./types";

/** Blocks look: multi-scale bounding boxes fitted to the picture's brightest,
 * moving, or most detailed blobs, streaks, and sparks, connected by sweeping
 * constellation arcs. */

export const MAX_BLOCKS = 128;
export const MAX_LINKS = 48;
/** Data texture: row 0 rects, row 1 block info (style, outline, shift, alpha). */
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
	/** 0 is the largest size (hero cloud), 3 the smallest (micro spark). */
	level: number;
}

export interface Block extends BlockRect {
	id: number;
	/** Drawn rect, eased toward the target one. */
	dx0: number;
	dy0: number;
	dx1: number;
	dy1: number;
	/** Smoothed center velocity in normalized units per second. */
	vx: number;
	vy: number;
	/** Fill used by Mix, 0..2. */
	style: number;
	/** Outline weight, 0..1. */
	outline: number;
	/** Visual opacity, 0..1 (kept crisp at 1 while visible; no murky fade ghosts). */
	alpha: number;
	/** 1 while live/held, 0 when collapsing out. */
	targetAlpha: number;
	/** Animation time when last matched to a live detection. */
	lastSeen: number;
	/** Animation time when born. */
	born: number;
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
	 * Same sign bows cleanly into a single sweeping arc. */
	bend1: number;
	bend2: number;
	/** 0..1, offsets the subtle breathing so curves don't move in lockstep. */
	phase: number;
	alpha: number;
	/** Animation time it started drawing itself in. */
	born: number;
}

export interface BlockGrid {
	mean: Float32Array;
	peak: Float32Array;
	gw: number;
	gh: number;
}

export interface BlocksState {
	blocks: Block[];
	links: BlockLink[];
	prevMean: Float32Array | null;
	/** Cached last grid so slider tweaks while paused update immediately. */
	lastGrid: BlockGrid | null;
	lastAspect: number;
	lastSig: string;
	lastTick: number;
	lastEase: number;
	nextId: number;
}

export function newBlocksState(): BlocksState {
	return {
		blocks: [],
		links: [],
		prevMean: null,
		lastGrid: null,
		lastAspect: 16 / 9,
		lastSig: "",
		lastTick: -1,
		lastEase: -1,
		nextId: 0,
	};
}

/** Signature of params that affect block placement or links. */
export function blocksParamSignature(p: TrackingParams): string {
	return `${p.blocks}|${p.follow}|${p.sensitivity.toFixed(3)}|${p.size.toFixed(3)}|${p.links.toFixed(3)}`;
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

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

const FLOOR = { light: 0.16, motion: 0.04, detail: 0.05 } as const;

/** 0..1 per cell: how much it holds what the blocks follow. The threshold sits
 * between the frame's average and its peak, keeping negative space clean while
 * capturing bursts, streaks, and sparks. */
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
		for (let i = 0; i < n; i++) v[i] = 0.35 * mean[i] + 0.65 * peak[i];
	} else if (params.follow === "motion") {
		if (!prevMean || prevMean.length !== n) return act;
		for (let i = 0; i < n; i++) v[i] = Math.abs(mean[i] - prevMean[i]);
	} else {
		for (let y = 1; y < gh - 1; y++) {
			for (let x = 1; x < gw - 1; x++) {
				const i = y * gw + x;
				const grad =
					Math.abs(mean[i + 1] - mean[i - 1]) +
					Math.abs(mean[i + gw] - mean[i - gw]);
				const spark = Math.max(0, peak[i] - mean[i]) * 0.45;
				v[i] = grad + spark;
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
		avg + (max - avg) * (0.76 - 0.58 * params.sensitivity),
	);
	const soft = Math.max(0.03, (max - th) * 0.45);
	for (let i = 0; i < n; i++) {
		act[i] = Math.min(1, Math.max(0, (v[i] - th) / soft));
	}
	return act;
}

/** Separable max-dilation so sparse firework sparks bridge into cohesive
 * burst clouds instead of fragmenting into uniform small squares. */
function dilateGrid(
	src: Float32Array,
	gw: number,
	gh: number,
	radius: number,
): Float32Array {
	const r = Math.max(1, radius | 0);
	const tmp = new Float32Array(gw * gh);
	const out = new Float32Array(gw * gh);
	for (let y = 0; y < gh; y++) {
		const row = y * gw;
		for (let x = 0; x < gw; x++) {
			const x0 = x > r ? x - r : 0;
			const x1 = x + r < gw ? x + r : gw - 1;
			let m = 0;
			for (let k = x0; k <= x1; k++) {
				const v = src[row + k];
				if (v > m) m = v;
			}
			tmp[row + x] = m;
		}
	}
	for (let x = 0; x < gw; x++) {
		for (let y = 0; y < gh; y++) {
			const y0 = y > r ? y - r : 0;
			const y1 = y + r < gh ? y + r : gh - 1;
			let m = 0;
			for (let k = y0; k <= y1; k++) {
				const v = tmp[k * gw + x];
				if (v > m) m = v;
			}
			out[y * gw + x] = m;
		}
	}
	return out;
}

/** Separable O(n) box blur for multi-scale blob grouping. */
function blurGrid(
	src: Float32Array,
	gw: number,
	gh: number,
	radius: number,
): Float32Array {
	const r = Math.max(1, radius | 0);
	const tmp = new Float32Array(gw * gh);
	const out = new Float32Array(gw * gh);
	for (let y = 0; y < gh; y++) {
		const row = y * gw;
		let sum = 0;
		let cnt = 0;
		for (let x = 0; x <= Math.min(r, gw - 1); x++) {
			sum += src[row + x];
			cnt++;
		}
		for (let x = 0; x < gw; x++) {
			tmp[row + x] = sum / cnt;
			const add = x + r + 1;
			if (add < gw) {
				sum += src[row + add];
				cnt++;
			}
			const rem = x - r;
			if (rem >= 0) {
				sum -= src[row + rem];
				cnt--;
			}
		}
	}
	for (let x = 0; x < gw; x++) {
		let sum = 0;
		let cnt = 0;
		for (let y = 0; y <= Math.min(r, gh - 1); y++) {
			sum += tmp[y * gw + x];
			cnt++;
		}
		for (let y = 0; y < gh; y++) {
			out[y * gw + x] = sum / cnt;
			const add = y + r + 1;
			if (add < gh) {
				sum += tmp[add * gw + x];
				cnt++;
			}
			const rem = y - r;
			if (rem >= 0) {
				sum -= tmp[rem * gw + x];
				cnt--;
			}
		}
	}
	return out;
}

interface BlobComp {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	count: number;
	sumW: number;
	cx: number;
	cy: number;
	sx: number;
	sy: number;
	peak: number;
}

/** 8-connected components above `threshold`, with tight bounds and weighted moments. */
function extractComponents(
	map: Float32Array,
	gw: number,
	gh: number,
	threshold: number,
): BlobComp[] {
	const n = gw * gh;
	const visited = new Uint8Array(n);
	const queue = new Int32Array(n);
	const comps: BlobComp[] = [];

	for (let i = 0; i < n; i++) {
		if (visited[i] || map[i] < threshold) continue;
		visited[i] = 1;
		let head = 0;
		let tail = 0;
		queue[tail++] = i;

		let minX = gw;
		let minY = gh;
		let maxX = 0;
		let maxY = 0;
		let count = 0;
		let sumW = 0;
		let sumX = 0;
		let sumY = 0;
		let sumX2 = 0;
		let sumY2 = 0;
		let peak = 0;

		while (head < tail) {
			const idx = queue[head++];
			const x = idx % gw;
			const y = (idx - x) / gw;
			const w = map[idx];
			count++;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			const cxCell = x + 0.5;
			const cyCell = y + 0.5;
			sumW += w;
			sumX += cxCell * w;
			sumY += cyCell * w;
			sumX2 += cxCell * cxCell * w;
			sumY2 += cyCell * cyCell * w;
			if (w > peak) peak = w;

			const y0 = y > 0 ? y - 1 : 0;
			const y1 = y + 1 < gh ? y + 1 : gh - 1;
			const x0 = x > 0 ? x - 1 : 0;
			const x1 = x + 1 < gw ? x + 1 : gw - 1;
			for (let ny = y0; ny <= y1; ny++) {
				const row = ny * gw;
				for (let nx = x0; nx <= x1; nx++) {
					const ni = row + nx;
					if (!visited[ni] && map[ni] >= threshold) {
						visited[ni] = 1;
						queue[tail++] = ni;
					}
				}
			}
		}

		const invW = sumW > 0 ? 1 / sumW : 1;
		const cx = sumX * invW;
		const cy = sumY * invW;
		const vx = Math.max(0.08, sumX2 * invW - cx * cx);
		const vy = Math.max(0.08, sumY2 * invW - cy * cy);
		comps.push({
			minX,
			minY,
			maxX,
			maxY,
			count,
			sumW,
			cx,
			cy,
			sx: Math.sqrt(vx),
			sy: Math.sqrt(vy),
			peak,
		});
	}
	return comps;
}

const SEED = 7;

interface Candidate extends BlockRect {
	score: number;
}

/** Local weighted centroid + anisotropic spread around a grid cell. */
function localMoments(
	act: Float32Array,
	gw: number,
	gh: number,
	ix: number,
	iy: number,
	rad: number,
	floor: number,
): { cx: number; cy: number; sx: number; sy: number; sumW: number } {
	const x0 = Math.max(0, ix - rad);
	const x1 = Math.min(gw - 1, ix + rad);
	const y0 = Math.max(0, iy - rad);
	const y1 = Math.min(gh - 1, iy + rad);
	let sumW = 0;
	let sumX = 0;
	let sumY = 0;
	let sumX2 = 0;
	let sumY2 = 0;
	const invR2 = 1 / Math.max(1, rad * rad * 1.4);
	for (let y = y0; y <= y1; y++) {
		const row = y * gw;
		const dy = y - iy;
		for (let x = x0; x <= x1; x++) {
			const v = act[row + x];
			if (v < floor) continue;
			const dx = x - ix;
			const falloff = Math.exp(-(dx * dx + dy * dy) * invR2);
			const w = v * Math.sqrt(v) * falloff;
			const px = x + 0.5;
			const py = y + 0.5;
			sumW += w;
			sumX += px * w;
			sumY += py * w;
			sumX2 += px * px * w;
			sumY2 += py * py * w;
		}
	}
	if (sumW <= 1e-6) {
		return { cx: ix + 0.5, cy: iy + 0.5, sx: 0.6, sy: 0.6, sumW: 0 };
	}
	const cx = sumX / sumW;
	const cy = sumY / sumW;
	const vx = Math.max(0.12, sumX2 / sumW - cx * cx);
	const vy = Math.max(0.12, sumY2 / sumW - cy * cy);
	return { cx, cy, sx: Math.sqrt(vx), sy: Math.sqrt(vy), sumW };
}

/** 3x3 non-maximum suppression with tiny tie-breaker so flat plateaus still seed peaks. */
function findPeaks(
	map: Float32Array,
	tie: Float32Array | null,
	gw: number,
	gh: number,
	threshold: number,
): number[] {
	const peaks: number[] = [];
	for (let y = 0; y < gh; y++) {
		const y0 = y > 0 ? y - 1 : 0;
		const y1 = y + 1 < gh ? y + 1 : gh - 1;
		for (let x = 0; x < gw; x++) {
			const i = y * gw + x;
			const v = map[i];
			if (v < threshold) continue;
			const tv = tie ? v + tie[i] * 0.008 : v;
			let isPeak = true;
			const x0 = x > 0 ? x - 1 : 0;
			const x1 = x + 1 < gw ? x + 1 : gw - 1;
			for (let ny = y0; ny <= y1 && isPeak; ny++) {
				const row = ny * gw;
				for (let nx = x0; nx <= x1; nx++) {
					const ni = row + nx;
					if (ni === i) continue;
					const nv = tie ? map[ni] + tie[ni] * 0.008 : map[ni];
					if (nv > tv || (nv === tv && ni < i)) {
						isPeak = false;
						break;
					}
				}
			}
			if (isPeak) peaks.push(i);
		}
	}
	return peaks;
}

/** Build a normalized Candidate from frame-unit center & size, verifying SAT fill. */
function makeCandidate(
	cx: number,
	cy: number,
	w: number,
	h: number,
	level: number,
	scoreBase: number,
	minFill: number,
	aspect: number,
	cw: number,
	gw: number,
	gh: number,
	sw: number,
	sat: Float64Array,
): Candidate | null {
	const x0 = clamp(cx - w * 0.5, 0, aspect);
	const x1 = clamp(cx + w * 0.5, 0, aspect);
	const y0 = clamp(cy - h * 0.5, 0, 1);
	const y1 = clamp(cy + h * 0.5, 0, 1);
	if (x1 - x0 < w * 0.45 || y1 - y0 < h * 0.45) return null;
	const c0 = Math.max(0, Math.floor(x0 / cw));
	const c1 = Math.min(gw, Math.ceil(x1 / cw));
	const r0 = Math.max(0, Math.floor(y0 * gh));
	const r1 = Math.min(gh, Math.ceil(y1 * gh));
	if (c1 <= c0 || r1 <= r0) return null;
	const sum =
		sat[r1 * sw + c1] -
		sat[r0 * sw + c1] -
		sat[r1 * sw + c0] +
		sat[r0 * sw + c0];
	const fill = sum / ((c1 - c0) * (r1 - r0));
	if (fill < minFill) return null;
	return {
		x0: x0 / aspect,
		x1: x1 / aspect,
		y0,
		y1,
		level,
		score: scoreBase * (0.45 + 0.55 * Math.sqrt(fill)),
	};
}

/** Where the blocks go this tick, largest first. `aspect` is the frame's
 * width over height. Produces a bold power-law hierarchy: 1–3 monumental hero
 * panes over dense clouds (bridging sparse sparks via dilation), rhythmic
 * anisotropic slabs on streaks/sub-clusters, and a delicate swarm of tiny
 * micro-squares centered on individual sparks. */
export function detectBlocks(
	grid: BlockGrid,
	act: Float32Array,
	aspect: number,
	params: TrackingParams,
): BlockRect[] {
	const { gw, gh } = grid;
	const sw = gw + 1;
	const sat = new Float64Array(sw * (gh + 1));
	let totalAct = 0;
	for (let y = 0; y < gh; y++) {
		let row = 0;
		for (let x = 0; x < gw; x++) {
			const a = act[y * gw + x];
			row += a;
			sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + row;
		}
		totalAct += row;
	}
	if (totalAct < 0.05) return [];

	// Frame units: height 1, width `aspect`.
	const cw = aspect / gw;
	const ch = 1 / gh;
	const cell = Math.max(cw, ch);
	const minDim = Math.min(aspect, 1);
	// Dramatic scale contrast: monumental hero windows down to jewel-like micro squares.
	const maxSide = Math.max(cell * 5, params.size * 3.4 * minDim);
	const minSide = Math.max(cell * 1.1, maxSide * 0.042);

	const budget = Math.min(params.blocks, MAX_BLOCKS);
	// Dilate before blurring so sparse pinpoint sparks merge into cohesive burst clouds.
	const dilateR = clamp(Math.round(maxSide / (cell * 12)), 2, 4);
	const macroR = clamp(Math.round(maxSide / (cell * 6)), 2, 6);
	const macroMap = blurGrid(dilateGrid(act, gw, gh, dilateR), gw, gh, macroR);
	const mesoMap = blurGrid(act, gw, gh, 1);

	const picked: Candidate[] = [];
	let carry = 0;

	// ---- Level 0: 1–3 Monumental hero cloud windows ----
	{
		const quota =
			budget < 5 ? 0 : Math.min(3, Math.max(1, Math.round(budget * 0.075)));
		const cands: Candidate[] = [];
		if (quota > 0) {
			const comps = extractComponents(macroMap, gw, gh, 0.24);
			for (const comp of comps) {
				const bw = (comp.maxX - comp.minX + 1) * cw;
				const bh = (comp.maxY - comp.minY + 1) * ch;
				if (Math.max(bw, bh) < maxSide * 0.24 || comp.count < 16) continue;

				if (bw <= maxSide * 1.3 && bh <= maxSide * 1.3) {
					const cx = comp.cx * cw;
					const cy = comp.cy * ch;
					const swBox = comp.sx * cw * 2.9;
					const shBox = comp.sy * ch * 2.9;
					let w = clamp(0.6 * bw + 0.4 * swBox, maxSide * 0.52, maxSide);
					let h = clamp(0.6 * bh + 0.4 * shBox, maxSide * 0.52, maxSide);
					// Bold near-square proportions for hero windows (0.74..1.35).
					const ar = w / h;
					if (ar > 1.35) w = h * 1.35;
					else if (ar < 0.74) h = w / 0.74;
					const c = makeCandidate(
						cx,
						cy,
						w,
						h,
						0,
						comp.peak * Math.sqrt(comp.sumW),
						0.025,
						aspect,
						cw,
						gw,
						gh,
						sw,
						sat,
					);
					if (c) cands.push(c);
				} else {
					// Large burst or bright scene: place monumental hero windows on macro peaks.
					const peaks = findPeaks(macroMap, null, gw, gh, 0.28);
					for (const pIdx of peaks) {
						const px = pIdx % gw;
						const py = (pIdx - px) / gw;
						if (
							px < comp.minX ||
							px > comp.maxX ||
							py < comp.minY ||
							py > comp.maxY
						) {
							continue;
						}
						const m = localMoments(
							macroMap,
							gw,
							gh,
							px,
							py,
							Math.max(5, Math.round(maxSide / (cell * 2.2))),
							0.2,
						);
						let w = clamp(m.sx * cw * 3.1, maxSide * 0.56, maxSide);
						let h = clamp(m.sy * ch * 3.1, maxSide * 0.56, maxSide);
						const ar = w / h;
						if (ar > 1.35) w = h * 1.35;
						else if (ar < 0.74) h = w / 0.74;
						const c = makeCandidate(
							m.cx * cw,
							m.cy * ch,
							w,
							h,
							0,
							macroMap[pIdx] * Math.sqrt(m.sumW + 1),
							0.03,
							aspect,
							cw,
							gw,
							gh,
							sw,
							sat,
						);
						if (c) cands.push(c);
					}
				}
			}
			// Fallback so any frame with a genuine spark cluster gets a hero anchor.
			if (cands.length === 0) {
				let bestIdx = -1;
				let bestV = 0.26;
				for (let i = 0; i < macroMap.length; i++) {
					if (macroMap[i] > bestV) {
						bestV = macroMap[i];
						bestIdx = i;
					}
				}
				if (bestIdx >= 0) {
					const px = bestIdx % gw;
					const py = (bestIdx - px) / gw;
					const c = makeCandidate(
						(px + 0.5) * cw,
						(py + 0.5) * ch,
						maxSide * 0.76,
						maxSide * 0.76,
						0,
						bestV,
						0.02,
						aspect,
						cw,
						gw,
						gh,
						sw,
						sat,
					);
					if (c) cands.push(c);
				}
			}
		}
		carry = pickLevel(cands, picked, quota, 0.3);
	}

	// ---- Level 1: Rhythmic medium & elongated slabs (rays, streaks, sub-clusters) ----
	{
		const quota = Math.round(budget * 0.16) + carry;
		const cands: Candidate[] = [];
		if (quota > 0) {
			// 1a: Exact connected-component bounding boxes -> tall/wide streak slabs.
			const comps = extractComponents(act, gw, gh, 0.44);
			for (const comp of comps) {
				if (comp.count < 3) continue;
				const bw = (comp.maxX - comp.minX + 1.4) * cw;
				const bh = (comp.maxY - comp.minY + 1.4) * ch;
				const span = Math.max(bw, bh);
				if (span < maxSide * 0.12 || span > maxSide * 0.58) continue;
				let w = clamp(bw, minSide * 1.4, maxSide * 0.56);
				let h = clamp(bh, minSide * 1.4, maxSide * 0.56);
				const ar = w / h;
				if (ar > 4.4) w = h * 4.4;
				else if (ar < 1 / 4.4) h = w * 4.4;
				const cx = (comp.minX + comp.maxX + 1) * 0.5 * cw;
				const cy = (comp.minY + comp.maxY + 1) * 0.5 * ch;
				const c = makeCandidate(
					cx,
					cy,
					w,
					h,
					1,
					comp.peak * 1.4 * (0.7 + 0.3 * Math.min(1, comp.count / 16)),
					0.06,
					aspect,
					cw,
					gw,
					gh,
					sw,
					sat,
				);
				if (c) cands.push(c);
			}

			// 1b: Anisotropic sub-cluster fitting on dilated-lightly meso map.
			const mesoCloud = blurGrid(dilateGrid(act, gw, gh, 1), gw, gh, 2);
			const mesoPeaks = findPeaks(mesoCloud, macroMap, gw, gh, 0.28);
			const rad = clamp(Math.round((maxSide * 0.2) / cell), 3, 9);
			for (const pIdx of mesoPeaks) {
				const px = pIdx % gw;
				const py = (pIdx - px) / gw;
				const m = localMoments(act, gw, gh, px, py, rad, 0.16);
				if (m.sumW < 0.8) continue;
				let w = clamp(m.sx * cw * 3.1, maxSide * 0.14, maxSide * 0.46);
				let h = clamp(m.sy * ch * 3.1, maxSide * 0.14, maxSide * 0.46);
				const ar = w / h;
				if (ar > 3.8) w = h * 3.8;
				else if (ar < 1 / 3.8) h = w * 3.8;
				const c = makeCandidate(
					m.cx * cw,
					m.cy * ch,
					w,
					h,
					1,
					mesoCloud[pIdx] * (0.85 + 0.15 * hash(SEED, pIdx, 1)),
					0.05,
					aspect,
					cw,
					gw,
					gh,
					sw,
					sat,
				);
				if (c) cands.push(c);
			}

			if (cands.length < quota) {
				seedActiveGrid(
					cands,
					act,
					mesoMap,
					1,
					maxSide * 0.34,
					maxSide * 0.16,
					maxSide * 0.46,
					0.12,
					aspect,
					cw,
					ch,
					gw,
					gh,
					sw,
					sat,
				);
			}
		}
		carry = pickLevel(cands, picked, quota, 0.34);
	}

	// ---- Level 2: Small-medium crisp accent squares & ray segments ----
	{
		const quota = Math.round(budget * 0.24) + carry;
		const cands: Candidate[] = [];
		if (quota > 0) {
			const comps = extractComponents(act, gw, gh, 0.58);
			for (const comp of comps) {
				if (comp.count < 2) continue;
				const bw = (comp.maxX - comp.minX + 1.1) * cw;
				const bh = (comp.maxY - comp.minY + 1.1) * ch;
				const span = Math.max(bw, bh);
				if (span < minSide * 1.4 || span > maxSide * 0.26) continue;
				let w = clamp(bw, minSide * 1.3, maxSide * 0.24);
				let h = clamp(bh, minSide * 1.3, maxSide * 0.24);
				const ar = w / h;
				if (ar > 3.2) w = h * 3.2;
				else if (ar < 1 / 3.2) h = w * 3.2;
				const cx = (comp.minX + comp.maxX + 1) * 0.5 * cw;
				const cy = (comp.minY + comp.maxY + 1) * 0.5 * ch;
				const c = makeCandidate(
					cx,
					cy,
					w,
					h,
					2,
					comp.peak * 1.25,
					0.06,
					aspect,
					cw,
					gw,
					gh,
					sw,
					sat,
				);
				if (c) cands.push(c);
			}

			const peaks = findPeaks(act, mesoMap, gw, gh, 0.26);
			const rad = clamp(Math.round((maxSide * 0.09) / cell), 2, 5);
			for (const pIdx of peaks) {
				const px = pIdx % gw;
				const py = (pIdx - px) / gw;
				const m = localMoments(act, gw, gh, px, py, rad, 0.14);
				let w = clamp(m.sx * cw * 2.6, maxSide * 0.075, maxSide * 0.2);
				let h = clamp(m.sy * ch * 2.6, maxSide * 0.075, maxSide * 0.2);
				const ar = w / h;
				if (ar > 2.6) w = h * 2.6;
				else if (ar < 1 / 2.6) h = w * 2.6;
				const c = makeCandidate(
					m.cx * cw,
					m.cy * ch,
					w,
					h,
					2,
					act[pIdx] * (0.8 + 0.2 * hash(SEED, pIdx, 2)),
					0.06,
					aspect,
					cw,
					gw,
					gh,
					sw,
					sat,
				);
				if (c) cands.push(c);
			}

			if (cands.length < quota) {
				seedActiveGrid(
					cands,
					act,
					mesoMap,
					2,
					maxSide * 0.16,
					maxSide * 0.08,
					maxSide * 0.2,
					0.08,
					aspect,
					cw,
					ch,
					gw,
					gh,
					sw,
					sat,
				);
			}
		}
		carry = pickLevel(cands, picked, quota, 0.3);
	}

	// ---- Level 3: Delicate micro spark squares (constellation dust) ----
	{
		const quota = budget - picked.length;
		const cands: Candidate[] = [];
		if (quota > 0) {
			const peaks = findPeaks(act, mesoMap, gw, gh, 0.14);
			for (const pIdx of peaks) {
				const px = pIdx % gw;
				const py = (pIdx - px) / gw;
				// Sub-cell 3x3 weighted centroid so spark boxes track smoothly.
				const m = localMoments(act, gw, gh, px, py, 1, 0.08);
				const cx = m.cx * cw;
				const cy = m.cy * ch;
				const v = act[pIdx];
				const side = minSide * (0.85 + 0.65 * Math.sqrt(v));
				const elong = clamp(m.sx / Math.max(0.2, m.sy), 0.85, 1.18);
				const w = side * Math.sqrt(elong);
				const h = side / Math.sqrt(elong);
				const nx = cx / aspect;
				const covered = isPointCovered(nx, cy, picked);
				const boost = covered ? 0.95 : 1.7;
				const c = makeCandidate(
					cx,
					cy,
					w,
					h,
					3,
					v * boost * (0.82 + 0.18 * hash(SEED, pIdx, 3)),
					0.04,
					aspect,
					cw,
					gw,
					gh,
					sw,
					sat,
				);
				if (c) cands.push(c);
			}

			if (cands.length < quota) {
				seedActiveGrid(
					cands,
					act,
					mesoMap,
					3,
					minSide * 1.4,
					minSide * 0.85,
					minSide * 1.5,
					0.06,
					aspect,
					cw,
					ch,
					gw,
					gh,
					sw,
					sat,
				);
			}
		}
		pickLevel(cands, picked, quota, 0.24);
	}

	// Sort largest/coarsest first so smaller foreground blocks layer cleanly on top.
	picked.sort((a, b) => {
		if (a.level !== b.level) return a.level - b.level;
		const aa = (a.x1 - a.x0) * (a.y1 - a.y0);
		const ba = (b.x1 - b.x0) * (b.y1 - b.y0);
		return ba - aa;
	});
	return picked.map(({ x0, y0, x1, y1, level }) => ({ x0, y0, x1, y1, level }));
}

/** Seed shape-fitted boxes across active plateaus/rims when distinct peaks run short. */
function seedActiveGrid(
	cands: Candidate[],
	act: Float32Array,
	mesoMap: Float32Array,
	level: number,
	side: number,
	minS: number,
	maxS: number,
	minFill: number,
	aspect: number,
	cw: number,
	ch: number,
	gw: number,
	gh: number,
	sw: number,
	sat: Float64Array,
): void {
	const stride = Math.max(cw * 2, side * 0.65);
	const cols = Math.ceil(aspect / stride) + 1;
	const rows = Math.ceil(1 / stride) + 1;
	const ox = hash(SEED, level, 11) * stride;
	const oy = hash(SEED, level, 12) * stride;
	const rad = Math.max(1, Math.round((side * 0.5) / Math.max(cw, ch)));
	for (let iy = 0; iy < rows; iy++) {
		for (let ix = 0; ix < cols; ix++) {
			const seed = level * 7919 + iy * 131 + ix;
			const fx = ox + ix * stride + (hash(SEED, seed, 5) - 0.5) * stride * 0.4;
			const fy = oy + iy * stride + (hash(SEED, seed, 6) - 0.5) * stride * 0.4;
			const gx = clamp(Math.floor(fx / cw), 0, gw - 1);
			const gy = clamp(Math.floor(fy / ch), 0, gh - 1);
			const v = Math.max(act[gy * gw + gx], mesoMap[gy * gw + gx]);
			if (v < minFill) continue;
			const m = localMoments(act, gw, gh, gx, gy, rad, minFill * 0.7);
			if (m.sumW <= 0) continue;
			const scaleVar = 0.8 + 0.4 * hash(SEED, seed, 4);
			let w = clamp(m.sx * cw * 2.8 * scaleVar, minS, maxS);
			let h = clamp(m.sy * ch * 2.8 * scaleVar, minS, maxS);
			const ar = w / h;
			if (ar > 2.6) w = h * 2.6;
			else if (ar < 1 / 2.6) h = w * 2.6;
			const c = makeCandidate(
				m.cx * cw,
				m.cy * ch,
				w,
				h,
				level,
				v * 0.65 * (0.75 + 0.25 * hash(SEED, seed, 7)),
				minFill,
				aspect,
				cw,
				gw,
				gh,
				sw,
				sat,
			);
			if (c) cands.push(c);
		}
	}
}

function isPointCovered(nx: number, ny: number, picked: Candidate[]): boolean {
	for (const p of picked) {
		if (nx >= p.x0 && nx <= p.x1 && ny >= p.y0 && ny <= p.y1) return true;
	}
	return false;
}

/** Pick up to `quota` non-buried candidates for one level; returns unused carry. */
function pickLevel(
	cands: Candidate[],
	picked: Candidate[],
	quota: number,
	sameOverlap: number,
): number {
	if (quota <= 0 || cands.length === 0) return Math.max(0, quota);
	cands.sort((p, q) => q.score - p.score);
	let taken = 0;
	for (const c of cands) {
		if (taken >= quota) break;
		if (buried(c, picked, sameOverlap)) continue;
		picked.push(c);
		taken++;
	}
	return quota - taken;
}

/** Reject a candidate if it duplicates a same-level block or nearly matches a
 * larger parent's footprint. Smaller blocks are free to nest over larger ones. */
function buried(
	c: Candidate,
	picked: Candidate[],
	sameOverlap: number,
): boolean {
	const area = (c.x1 - c.x0) * (c.y1 - c.y0);
	if (area <= 0) return true;
	for (const p of picked) {
		const ix = Math.min(c.x1, p.x1) - Math.max(c.x0, p.x0);
		if (ix <= 0) continue;
		const iy = Math.min(c.y1, p.y1) - Math.max(c.y0, p.y0);
		if (iy <= 0) continue;
		const inter = ix * iy;
		if (p.level === c.level) {
			if (inter / area > sameOverlap) return true;
		} else {
			const pArea = (p.x1 - p.x0) * (p.y1 - p.y0);
			if (area / Math.max(1e-9, pArea) > 0.48 && inter / area > 0.6) {
				return true;
			}
		}
	}
	return false;
}

/** Outline weight per level: monumental hero panes stay clean & borderless,
 * while medium/micro boxes get crisp architectural hairlines. */
const LEVEL_OUTLINE = [0.0, 0.46, 0.78, 0.96];
/** Brief 1-tick hold grace before a lost block crisply collapses out (no murky
 * translucent grey ghosts lingering over dark footage). */
const GRACE_S = 0.05;
const COLLAPSE_S = 0.08;

function blockOutline(id: number, level: number): number {
	if (level === 1 && hash(SEED, id, 9) < 0.35) return 0;
	return LEVEL_OUTLINE[level] ?? 0.9;
}

/** Editorial Mix assignment: crisp Invert forms the dominant graphic backbone
 * (~85%), while only the monumental hero pane(s) and a sparse echo carry a
 * single curated accent style — cohesive art direction instead of random
 * rainbow confetti. */
function pickMixStyle(id: number, level: number): number {
	if (level === 0) {
		// Hero windows carry a curated luminous accent (mostly Heat, occasionally Plasma).
		return hash(SEED, id, 8) < 0.68 ? 1 : 2;
	}
	// Smaller slabs & micro swarm stay predominantly crisp Invert for clean graphic cohesion.
	const r = hash(SEED, id, 8);
	if (r < 0.86) return 0;
	return r < 0.95 ? 1 : 2;
}

/** Carry identities over from the last tick via best-pair matching across
 * adjacent size levels, so growing/moving blobs glide smoothly and vanished
 * blocks hold briefly then collapse cleanly without murky grey ghosts. */
export function trackBlocks(
	state: BlocksState,
	rects: BlockRect[],
	params: TrackingParams,
	time: number,
): void {
	const isFresh =
		state.lastTick < 0 || time < state.lastTick || time - state.lastTick > 0.5;
	const dt = isFresh ? 0 : Math.max(0.001, time - state.lastTick);
	const prev = isFresh ? [] : state.blocks;

	// Build candidate (prev, rect) match pairs and assign lowest-cost greedily.
	const pairs: { pi: number; ri: number; cost: number }[] = [];
	for (let ri = 0; ri < rects.length; ri++) {
		const r = rects[ri];
		const rcx = (r.x0 + r.x1) * 0.5;
		const rcy = (r.y0 + r.y1) * 0.5;
		const rSpan = Math.max(r.x1 - r.x0, r.y1 - r.y0);
		for (let pi = 0; pi < prev.length; pi++) {
			const p = prev[pi];
			if (Math.abs(p.level - r.level) > 1) continue;
			const pSpan = Math.max(p.x1 - p.x0, p.y1 - p.y0);
			const ratio =
				Math.max(pSpan, rSpan) / Math.max(1e-4, Math.min(pSpan, rSpan));
			if (ratio > 2.2) continue;
			const predX = (p.x0 + p.x1) * 0.5 + p.vx * dt * 0.45;
			const predY = (p.y0 + p.y1) * 0.5 + p.vy * dt * 0.45;
			const d = Math.hypot(predX - rcx, predY - rcy);
			const reach = Math.max(0.045, 0.72 * Math.max(pSpan, rSpan));
			if (d >= reach) continue;
			const cost =
				d / reach +
				0.32 * (ratio - 1) +
				(p.level !== r.level ? 0.18 : 0) +
				(p.targetAlpha === 0 ? 0.15 : 0);
			pairs.push({ pi, ri, cost });
		}
	}
	pairs.sort((a, b) => a.cost - b.cost);

	const usedPrev = new Uint8Array(prev.length);
	const matchedRect = new Int32Array(rects.length).fill(-1);
	for (const { pi, ri } of pairs) {
		if (usedPrev[pi] || matchedRect[ri] >= 0) continue;
		usedPrev[pi] = 1;
		matchedRect[ri] = pi;
	}

	const next: Block[] = [];
	for (let ri = 0; ri < rects.length; ri++) {
		const r = rects[ri];
		const pi = matchedRect[ri];
		if (pi >= 0) {
			const p = prev[pi];
			const oldCx = (p.x0 + p.x1) * 0.5;
			const oldCy = (p.y0 + p.y1) * 0.5;
			const newCx = (r.x0 + r.x1) * 0.5;
			const newCy = (r.y0 + r.y1) * 0.5;
			const instVx = dt > 0 ? clamp((newCx - oldCx) / dt, -2.5, 2.5) : 0;
			const instVy = dt > 0 ? clamp((newCy - oldCy) / dt, -2.5, 2.5) : 0;
			next.push({
				...p,
				...r,
				vx: p.vx * 0.45 + instVx * 0.55,
				vy: p.vy * 0.45 + instVy * 0.55,
				outline: blockOutline(p.id, r.level),
				alpha: 1,
				targetAlpha: 1,
				lastSeen: time,
			});
			continue;
		}
		const id = state.nextId++;
		// Crisp architectural unfold on live spawn at full opacity (no grey fade-in).
		const inset = isFresh ? 0 : 0.14;
		const bw = r.x1 - r.x0;
		const bh = r.y1 - r.y0;
		next.push({
			...r,
			id,
			dx0: r.x0 + bw * inset,
			dy0: r.y0 + bh * inset,
			dx1: r.x1 - bw * inset,
			dy1: r.y1 - bh * inset,
			vx: 0,
			vy: 0,
			style: pickMixStyle(id, r.level),
			outline: blockOutline(id, r.level),
			alpha: 1,
			targetAlpha: 1,
			lastSeen: time,
			born: time,
		});
	}

	// Hold vanished blocks briefly at full crispness, then collapse their geometry
	// cleanly to a point instead of fading into muddy grey translucent ghosts.
	if (!isFresh) {
		for (let pi = 0; pi < prev.length; pi++) {
			if (usedPrev[pi] || next.length >= MAX_BLOCKS) continue;
			const p = prev[pi];
			const missed = time - p.lastSeen;
			if (missed >= GRACE_S + COLLAPSE_S) continue;
			const driftX = p.vx * dt * 0.35;
			const driftY = p.vy * dt * 0.35;
			if (missed < GRACE_S) {
				next.push({
					...p,
					x0: clamp(p.x0 + driftX, 0, 1),
					x1: clamp(p.x1 + driftX, 0, 1),
					y0: clamp(p.y0 + driftY, 0, 1),
					y1: clamp(p.y1 + driftY, 0, 1),
					alpha: 1,
					targetAlpha: 1,
				});
			} else {
				const cx = clamp((p.x0 + p.x1) * 0.5 + driftX, 0, 1);
				const cy = clamp((p.y0 + p.y1) * 0.5 + driftY, 0, 1);
				next.push({
					...p,
					x0: cx,
					x1: cx,
					y0: cy,
					y1: cy,
					alpha: 1,
					targetAlpha: 0,
				});
			}
		}
	}

	// Painter's order: monumental hero panes first, micro foreground sparks last.
	next.sort((a, b) => {
		if (a.level !== b.level) return a.level - b.level;
		const aa = (a.x1 - a.x0) * (a.y1 - a.y0);
		const ba = (b.x1 - b.x0) * (b.y1 - b.y0);
		return ba - aa;
	});

	state.blocks = next;
	relink(state, params, time);
}

/** Build a structured network of sweeping bridge arcs between clusters and
 * constellation arcs fanning from hubs to surrounding satellite boxes. */
function relink(
	state: BlocksState,
	params: TrackingParams,
	time: number,
): void {
	const blocks = state.blocks;
	const live = blocks.filter((b) => b.targetAlpha > 0);
	const want = Math.min(
		Math.round(params.links * MAX_LINKS),
		Math.max(0, live.length - 1),
	);

	const byId = new Map<number, Block>();
	for (const b of blocks) byId.set(b.id, b);

	const links = state.links.filter((l) => byId.has(l.a) && byId.has(l.b));
	if (links.length > want) links.length = want;
	if (want <= 0 || live.length < 2) {
		state.links = links;
		return;
	}

	let gx = 0;
	let gy = 0;
	for (const b of live) {
		gx += (b.x0 + b.x1) * 0.5;
		gy += (b.y0 + b.y1) * 0.5;
	}
	gx /= live.length;
	gy /= live.length;

	const degree = new Map<number, number>();
	const hasEdge = (a: number, b: number) =>
		links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
	for (const l of links) {
		degree.set(l.a, (degree.get(l.a) ?? 0) + 1);
		degree.set(l.b, (degree.get(l.b) ?? 0) + 1);
	}

	const rng = mulberry32(state.nextId * 131 + links.length * 17 + 3);
	const center = (b: Block): [number, number] => [
		(b.x0 + b.x1) * 0.5,
		(b.y0 + b.y1) * 0.5,
	];

	const addLink = (a: Block, b: Block, bridge: boolean): boolean => {
		if (a.id === b.id || hasEdge(a.id, b.id)) return false;
		const [ax, ay] = center(a);
		const [bx, by] = center(b);
		const dx = bx - ax;
		const dy = by - ay;
		const len = Math.hypot(dx, dy);
		if (len < 0.04) return false;

		const nx = -dy / len;
		const ny = dx / len;
		const mx = (ax + bx) * 0.5 - gx;
		const my = (ay + by) * 0.5 - gy;
		let dot = nx * mx + ny * my;
		if (Math.abs(dot) < 0.04) dot = -ny;
		let side = dot >= 0 ? 1 : -1;
		if (bridge && links.length % 3 === 1) side = -side;

		const fan = ((links.length % 5) / 4) * 0.14;
		const bow = bridge
			? 0.13 + fan + rng() * 0.12
			: 0.11 + fan * 0.8 + rng() * 0.13;
		const bend1 = bow * side;
		const bend2 = bow * (0.86 + rng() * 0.28) * side;

		links.push({
			a: a.id,
			b: b.id,
			au: 0.44 + rng() * 0.12,
			av: 0.44 + rng() * 0.12,
			bu: 0.44 + rng() * 0.12,
			bv: 0.44 + rng() * 0.12,
			bend1,
			bend2,
			phase: rng(),
			alpha: bridge ? 0.55 + rng() * 0.32 : 0.45 + rng() * 0.35,
			born: time,
		});
		degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
		degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
		return true;
	};

	const bridgeTarget = Math.min(want, Math.max(1, Math.round(want * 0.35)));
	const hubCount = Math.min(
		live.length,
		Math.max(4, Math.ceil(live.length * 0.4)),
	);
	for (
		let tries = 0;
		links.length < bridgeTarget && tries < bridgeTarget * 8;
		tries++
	) {
		const a = live[Math.floor(rng() * hubCount)];
		const [ax, ay] = center(a);
		let best: Block | null = null;
		let bestScore = -Infinity;
		for (let j = 0; j < live.length; j++) {
			const cand = live[j];
			if (cand.id === a.id || hasEdge(a.id, cand.id)) continue;
			const [cx, cy] = center(cand);
			const d = Math.hypot(cx - ax, cy - ay);
			if (d < 0.13) continue;
			const degPen = (degree.get(cand.id) ?? 0) * 0.42;
			const score = d * (1.15 - cand.level * 0.15) - degPen + rng() * 0.12;
			if (score > bestScore) {
				bestScore = score;
				best = cand;
			}
		}
		if (best) addLink(a, best, true);
	}

	const hubs = Math.min(
		live.length,
		Math.max(6, Math.ceil(live.length * 0.45)),
	);
	for (let tries = 0; links.length < want && tries < want * 8; tries++) {
		const a = live[Math.floor(rng() * hubs)];
		const [ax, ay] = center(a);
		let best: Block | null = null;
		let bestScore = -Infinity;
		for (let j = 0; j < live.length; j++) {
			const cand = live[j];
			if (cand.id === a.id || hasEdge(a.id, cand.id)) continue;
			const [cx, cy] = center(cand);
			const d = Math.hypot(cx - ax, cy - ay);
			if (d < 0.05 || d > 0.48) continue;
			const distFit = 1 - Math.abs(d - 0.18) / 0.32;
			const degPen = (degree.get(cand.id) ?? 0) * 0.55;
			const score = distFit - degPen + rng() * 0.35;
			if (score > bestScore) {
				bestScore = score;
				best = cand;
			}
		}
		if (best) addLink(a, best, false);
	}

	for (let tries = 0; links.length < want && tries < want * 4; tries++) {
		const a = live[Math.floor(rng() * live.length)];
		const b = live[Math.floor(rng() * live.length)];
		if (a.id === b.id || hasEdge(a.id, b.id)) continue;
		const [ax, ay] = center(a);
		const [bx, by] = center(b);
		if (Math.hypot(bx - ax, by - ay) < 0.015) continue;
		const side = rng() < 0.5 ? -1 : 1;
		const bow = 0.16 + rng() * 0.16;
		links.push({
			a: a.id,
			b: b.id,
			au: 0.5,
			av: 0.5,
			bu: 0.5,
			bv: 0.5,
			bend1: bow * side,
			bend2: bow * side,
			phase: rng(),
			alpha: 0.48 + rng() * 0.3,
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
	state.lastGrid = grid;
	state.lastAspect = aspect;
	state.lastSig = blocksParamSignature(params);
	state.lastTick = time;
}

/** Re-run placement on the cached grid when params change while paused. */
export function reanalyzeBlocks(
	state: BlocksState,
	params: TrackingParams,
	time: number,
): void {
	if (!state.lastGrid) return;
	const act = activityMap(state.lastGrid, state.prevMean, params);
	const rects = detectBlocks(state.lastGrid, act, state.lastAspect, params);
	const savedTick = state.lastTick;
	state.lastTick = -1;
	trackBlocks(state, rects, params, time);
	state.lastTick = savedTick;
	state.lastSig = blocksParamSignature(params);
	for (const b of state.blocks) {
		b.dx0 = b.x0;
		b.dy0 = b.y0;
		b.dx1 = b.x1;
		b.dy1 = b.y1;
		b.alpha = 1;
	}
}

/** Glide each drawn rect toward its target; collapsing blocks shrink crisply
 * to zero rather than turning into murky translucent ghosts. A jump back snaps. */
export function easeBlocks(state: BlocksState, time: number): void {
	const dt = time - state.lastEase;
	const snap = state.lastEase < 0 || dt < 0 || dt > 0.5;
	const kLive = snap ? 1 : 1 - Math.exp(-dt * 26);
	const kDrop = snap ? 1 : 1 - Math.exp(-dt * 34);
	state.lastEase = time;
	let write = 0;
	for (let i = 0; i < state.blocks.length; i++) {
		const b = state.blocks[i];
		const k = b.targetAlpha > 0 ? kLive : kDrop;
		b.dx0 += (b.x0 - b.dx0) * k;
		b.dy0 += (b.y0 - b.dy0) * k;
		b.dx1 += (b.x1 - b.dx1) * k;
		b.dy1 += (b.y1 - b.dy1) * k;
		b.alpha = 1;
		if (
			b.targetAlpha === 0 &&
			(snap || (b.dx1 - b.dx0 < 0.004 && b.dy1 - b.dy0 < 0.004))
		) {
			continue;
		}
		state.blocks[write++] = b;
	}
	state.blocks.length = write;
}

/** Write the blocks into `out` (BLOCKS_TEX_W x BLOCKS_TEX_H RGBA). */
export function packBlocks(state: BlocksState, out: Float32Array): number {
	const row = BLOCKS_TEX_W * 4;
	const count = Math.min(state.blocks.length, MAX_BLOCKS);
	for (let i = 0; i < count; i++) {
		const b = state.blocks[i];
		out.set([b.dx0, b.dy0, b.dx1, b.dy1], i * 4);
		out.set(
			[b.style, b.outline, hash(SEED, b.id, 10) * 2 - 1, b.alpha],
			row + i * 4,
		);
	}
	return count;
}

const GROW_S = 0.36;

/** Each link as a sleek hairline ribbon along a taut sweeping cubic arc: it
 * draws itself in from its first block, glides with both endpoints, and gently
 * refines toward its anchors. Returns the vertex count. */
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
		const linkAlpha = l.alpha * Math.min(a.alpha, b.alpha);
		if (linkAlpha <= 0.01) continue;
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
		const breath = time * 0.75 + l.phase * Math.PI * 2;
		const k1 = (l.bend1 + 0.018 * Math.sin(breath)) * len;
		const k2 = (l.bend2 + 0.018 * Math.sin(breath * 0.83 + 1.6)) * len;
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
			o = ribbonVertex(out, o, pts, p, 1, lineWidth, linkAlpha, width, height);
			o = ribbonVertex(out, o, pts, p, -1, lineWidth, linkAlpha, width, height);
			o = ribbonVertex(out, o, pts, q, 1, lineWidth, linkAlpha, width, height);
			o = ribbonVertex(out, o, pts, q, 1, lineWidth, linkAlpha, width, height);
			o = ribbonVertex(out, o, pts, p, -1, lineWidth, linkAlpha, width, height);
			o = ribbonVertex(out, o, pts, q, -1, lineWidth, linkAlpha, width, height);
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
	const half = lineWidth * 0.5 * (0.58 + 0.42 * swell);
	const reach = (half + 1) * side;
	out[o] = (pts[p] + pts[p + 2] * reach) / width;
	out[o + 1] = (pts[p + 1] + pts[p + 3] * reach) / height;
	out[o + 2] = reach;
	out[o + 3] = half;
	out[o + 4] = alpha * (0.58 + 0.42 * swell);
	return o + RIBBON_FLOATS;
}
