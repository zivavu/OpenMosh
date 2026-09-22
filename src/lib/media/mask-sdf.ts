/** Erase masks as signed distance fields, so two painted shapes have an honest
 * in-between. Cross-fading the masks reads as ghosting. */

/** How far from the edge the field still carries a gradient, in mask pixels. Beyond
 * this it saturates and two shapes further apart shrink out and grow in. */
export const MASK_SDF_RANGE = 128;

/** Squared 1-D distance transform (Felzenszwalb & Huttenlocher): the lower envelope
 * of parabolas rooted at each cell. */
function edt1d(f: Float64Array, n: number, out: Float64Array): void {
	// v: parabola roots in the envelope; z: where consecutive ones intersect.
	const v = new Int32Array(n);
	const z = new Float64Array(n + 1);
	let k = 0;
	v[0] = 0;
	z[0] = -Infinity;
	z[1] = Infinity;
	for (let q = 1; q < n; q++) {
		let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		while (s <= z[k]) {
			k--;
			s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		}
		k++;
		v[k] = q;
		z[k] = s;
		z[k + 1] = Infinity;
	}
	k = 0;
	for (let q = 0; q < n; q++) {
		while (z[k + 1] < q) k++;
		const d = q - v[k];
		out[q] = d * d + f[v[k]];
	}
}

/** Squared euclidean distance to the nearest cell where `inside` is true. */
function edt2d(
	inside: Uint8Array,
	w: number,
	h: number,
	want: 0 | 1,
): Float64Array {
	const INF = 1e12;
	const grid = new Float64Array(w * h);
	for (let i = 0; i < grid.length; i++) {
		grid[i] = inside[i] === want ? 0 : INF;
	}
	const col = new Float64Array(h);
	const colOut = new Float64Array(h);
	const row = new Float64Array(w);
	const rowOut = new Float64Array(w);
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) col[y] = grid[y * w + x];
		edt1d(col, h, colOut);
		for (let y = 0; y < h; y++) grid[y * w + x] = colOut[y];
	}
	for (let y = 0; y < h; y++) {
		const base = y * w;
		for (let x = 0; x < w; x++) row[x] = grid[base + x];
		edt1d(row, w, rowOut);
		for (let x = 0; x < w; x++) grid[base + x] = rowOut[x];
	}
	return grid;
}

/** A painted mask with its distance field packed alongside it. In: RGBA where red
 * is coverage (255 keeps, 0 erases). Out: red still coverage, alpha the signed distance. */
/** Middle of a mask's erased region, or null when it erases nothing. */
export type MaskCentre = { x: number; y: number } | null;

export interface MaskField {
	/** RGBA: coverage in red, encoded signed distance in alpha. */
	data: Uint8ClampedArray;
	/** Middle of the erased region, normalized to the mask. Two shapes that do not
	 * overlap must be brought onto each other before their boundaries can be interpolated. */
	centre: MaskCentre;
}

export function maskToSdf(
	rgba: Uint8ClampedArray,
	w: number,
	h: number,
): MaskField {
	const n = w * h;
	const inside = new Uint8Array(n);
	// Erased is "inside the shape": that is the region whose boundary moves.
	for (let i = 0; i < n; i++) inside[i] = rgba[i * 4] < 128 ? 1 : 0;

	const toInside = edt2d(inside, w, h, 1);
	const toOutside = edt2d(inside, w, h, 0);

	let sx = 0;
	let sy = 0;
	let count = 0;
	const out = new Uint8ClampedArray(n * 4);
	for (let i = 0; i < n; i++) {
		if (inside[i]) {
			sx += i % w;
			sy += (i / w) | 0;
			count++;
		}
		// Positive outside the erased shape (kept), negative within it. Both legs measure
		// to the *other* region, so the contour lands between the two pixels.
		const d = inside[i] ? -Math.sqrt(toOutside[i]) : Math.sqrt(toInside[i]);
		const enc = 0.5 + d / (2 * MASK_SDF_RANGE);
		const cov = rgba[i * 4];
		out[i * 4] = cov;
		out[i * 4 + 1] = cov;
		out[i * 4 + 2] = cov;
		out[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, enc)) * 255);
	}
	return {
		data: out,
		centre: count > 0 ? { x: sx / count / w, y: sy / count / h } : null,
	};
}

/** How far the second shape's middle sits from the first's, in mask uv. What the
 * morph slides along. */
export function maskShift(
	a: MaskCentre,
	b: MaskCentre,
): { x: number; y: number } {
	if (!a || !b) return { x: 0, y: 0 };
	return { x: b.x - a.x, y: b.y - a.y };
}

/** Coverage back out of an encoded distance, matching the shader's reconstruction
 * so the dialog's preview agrees with the canvas. */
const SOFT = 6;

export function sdfCoverage(enc: number): number {
	const d = (enc - 0.5) * 2 * MASK_SDF_RANGE;
	return Math.min(1, Math.max(0, d / SOFT + 0.5));
}

export const MASK_SDF_SOFT = SOFT;
