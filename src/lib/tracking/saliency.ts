import type { SalPoint, TrackingParams } from "./types";

/** Convert a row-major RGBA buffer (top-first) to a 0..1 luminance grid. */
export function lumFromRGBA(rgba: Uint8Array, n: number): Float32Array {
	const lum = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const r = rgba[i * 4];
		const g = rgba[i * 4 + 1];
		const b = rgba[i * 4 + 2];
		lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	}
	return lum;
}

/** Window radius the gradients are pooled over. */
const WINDOW_R = 2;
/** Cells kept clear of the picture's edge, so a tracker's template fits inside it. */
export const MARGIN = 4;
/** A border row or column this dark and flat is a letterbox bar or empty margin.
 * Only black counts: a plain backdrop or clear sky is still picture. */
const BLACK = 0.08;
const FLAT_LINE = 0.03;

export interface Bounds {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** The picture inside any letterbox bars or empty margin, in inclusive cells. */
export function contentBounds(
	lum: Float32Array,
	gw: number,
	gh: number,
): Bounds {
	const flat = (start: number, step: number, count: number) => {
		let sum = 0;
		let sq = 0;
		for (let k = 0; k < count; k++) {
			const v = lum[start + k * step];
			sum += v;
			sq += v * v;
		}
		const mean = sum / count;
		const spread = Math.sqrt(Math.max(0, sq / count - mean * mean));
		return mean < BLACK && spread < FLAT_LINE;
	};
	let y0 = 0;
	let y1 = gh - 1;
	while (y0 < y1 && flat(y0 * gw, 1, gw)) y0++;
	while (y1 > y0 && flat(y1 * gw, 1, gw)) y1--;
	let x0 = 0;
	let x1 = gw - 1;
	const rows = y1 - y0 + 1;
	while (x0 < x1 && flat(y0 * gw + x0, gw, rows)) x0++;
	while (x1 > x0 && flat(y0 * gw + x1, gw, rows)) x1--;
	return { x0, y0, x1, y1 };
}

/** Content-aware target picking from a small downsampled luminance grid. A cell
 * scores how much a box-sized spot around it stands out from its surroundings, so
 * boxes sit on things rather than on their outlines, weighted by how much texture
 * the tracker has to hold there. Only the picture counts: letterbox bars and empty
 * margins are trimmed off first. The strongest cells are then picked greedily with
 * spacing so boxes don't clump. Returns points in normalized coords (y: top→bottom).
 *
 * `lum` is row-major starting at the image TOP, so normalized y = row / (gh - 1). */
export function computeSaliency(
	lum: Float32Array,
	gw: number,
	gh: number,
	params: TrackingParams,
): SalPoint[] {
	const n = gw * gh;
	const box = params.size * Math.min(gw, gh);
	const inner = Math.max(1, Math.round(box * 0.3));
	const outer = Math.max(inner + 2, Math.round(box * 0.9));
	const b = contentBounds(lum, gw, gh);
	// The surround stays inside the picture, so its edge never reads as contrast.
	const inset = Math.max(MARGIN, outer);
	const x0 = b.x0 + inset;
	const x1 = b.x1 - inset;
	const y0 = b.y0 + inset;
	const y1 = b.y1 - inset;
	if (x0 > x1 || y0 > y1) return [];

	// Summed-area table: any box mean in four lookups.
	const sw = gw + 1;
	const sat = new Float64Array(sw * (gh + 1));
	for (let y = 0; y < gh; y++) {
		let row = 0;
		for (let x = 0; x < gw; x++) {
			row += lum[y * gw + x];
			sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + row;
		}
	}
	const boxMean = (x: number, y: number, r: number) => {
		const l = x - r;
		const t = y - r;
		const rr = x + r + 1;
		const bb = y + r + 1;
		const sum =
			sat[bb * sw + rr] - sat[t * sw + rr] - sat[bb * sw + l] + sat[t * sw + l];
		return sum / ((2 * r + 1) * (2 * r + 1));
	};

	const ixx = new Float32Array(n);
	const iyy = new Float32Array(n);
	const ixy = new Float32Array(n);
	for (let y = 1; y < gh - 1; y++) {
		for (let x = 1; x < gw - 1; x++) {
			const i = y * gw + x;
			const gx = (lum[i + 1] - lum[i - 1]) * 0.5;
			const gy = (lum[i + gw] - lum[i - gw]) * 0.5;
			ixx[i] = gx * gx;
			iyy[i] = gy * gy;
			ixy[i] = gx * gy;
		}
	}

	const contrast = new Float32Array(n);
	const texture = new Float32Array(n);
	let maxTexture = 0;
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			let a = 0;
			let c = 0;
			let d = 0;
			for (let oy = -WINDOW_R; oy <= WINDOW_R; oy++) {
				for (let ox = -WINDOW_R; ox <= WINDOW_R; ox++) {
					const j = (y + oy) * gw + x + ox;
					a += ixx[j];
					c += ixy[j];
					d += iyy[j];
				}
			}
			// Smaller eigenvalue of the structure tensor: high on corners and texture,
			// near zero along a straight edge.
			const half = (a - d) * 0.5;
			const t = Math.sqrt(
				Math.max(0, (a + d) * 0.5 - Math.sqrt(half * half + c * c)),
			);
			const i = y * gw + x;
			texture[i] = t;
			if (t > maxTexture) maxTexture = t;
			contrast[i] = Math.abs(boxMean(x, y, inner) - boxMean(x, y, outer));
		}
	}
	if (maxTexture <= 0) return [];

	const score = new Float32Array(n);
	let maxScore = 0;
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const i = y * gw + x;
			const hold = Math.min(1, texture[i] / (maxTexture * 0.3));
			const s = contrast[i] * (0.25 + 0.75 * hold);
			score[i] = s;
			if (s > maxScore) maxScore = s;
		}
	}

	// Collect candidates above a sensitivity-scaled threshold.
	if (maxScore <= 0) return [];
	const threshold = maxScore * (0.08 + params.sensitivity * 0.32);

	const candidates: SalPoint[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const s = score[y * gw + x];
			if (s < threshold) continue;
			candidates.push({ x: x / (gw - 1), y: y / (gh - 1), score: s });
		}
	}
	candidates.sort((a, b) => b.score - a.score);

	// Greedy non-maximum suppression: keep strong points far enough apart.
	// Higher sensitivity packs boxes tighter; lower spreads them out.
	const minDist = (0.18 - params.sensitivity * 0.1) * (1 + 4 / params.count);
	const minDist2 = minDist * minDist;
	const picked: SalPoint[] = [];
	for (const c of candidates) {
		if (picked.length >= params.count) break;
		let ok = true;
		for (const p of picked) {
			const dx = p.x - c.x;
			const dy = p.y - c.y;
			if (dx * dx + dy * dy < minDist2) {
				ok = false;
				break;
			}
		}
		if (ok) picked.push(c);
	}

	return picked;
}
