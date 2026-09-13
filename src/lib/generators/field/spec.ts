import type { Colors } from "../palette";

export const FIELD_KINDS = ["voronoi", "stripes", "plasma", "rings"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Shader-side index of each kind — keep in step with `uField` in the shader. */
export const FIELD_INDEX: Record<FieldKind, number> = {
	voronoi: 0,
	stripes: 1,
	plasma: 2,
	rings: 3,
};

/** 0 = flat, 1 = polar (tunnel), 2 = kaleidoscope mirror. */
export type Domain = 0 | 1 | 2;

/**
 * A height field mapped through the shared ramp and crease lighting. `params`
 * mean different things per kind:
 *
 * - voronoi: [jitter 0–1, metric 0 euclid/1 manhattan/2 chebyshev, look 0 blobs/1 cracks/2 flat cells, warp]
 * - stripes: [frequency, warp, hardness 0–1, stripe angle rad]
 * - plasma:  [x freq, y freq, diagonal freq, radial freq]
 * - rings:   [centres 1–4, frequency, decay, linear-wave mix 0–1]
 */
export interface FieldSpec {
	gen: "field";
	field: FieldKind;
	seed: number;
	offset: [number, number];
	scale: number;
	domain: Domain;
	/** Ramp repeats across the height range; 1 = plain, more = banding. */
	cycles: number;
	params: [number, number, number, number];
	angle: number;
	light: number;
	contrast: number;
	gamma: number;
	grain: number;
	colors: Colors;
}

const HEX = /^#[0-9a-f]{6}$/i;

function finite(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

export function isFieldSpec(v: unknown): v is FieldSpec {
	if (!v || typeof v !== "object") return false;
	const s = v as Record<string, unknown>;
	if (s.gen !== "field") return false;
	if (!FIELD_KINDS.includes(s.field as FieldKind)) return false;
	if (s.domain !== 0 && s.domain !== 1 && s.domain !== 2) return false;
	for (const k of [
		"seed",
		"scale",
		"cycles",
		"angle",
		"light",
		"contrast",
		"gamma",
		"grain",
	])
		if (!finite(s[k])) return false;
	if (
		!Array.isArray(s.offset) ||
		s.offset.length !== 2 ||
		!s.offset.every(finite)
	)
		return false;
	if (
		!Array.isArray(s.params) ||
		s.params.length !== 4 ||
		!s.params.every(finite)
	)
		return false;
	const cols = s.colors;
	return (
		Array.isArray(cols) &&
		cols.length === 5 &&
		cols.every((c) => typeof c === "string" && HEX.test(c))
	);
}
