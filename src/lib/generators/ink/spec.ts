import type { Colors } from "../palette";
import { allFinite, isColors, isRecord, isSeed } from "../spec-check";

export const INK_STYLES = ["strands", "brush"] as const;
export type InkStyle = (typeof INK_STYLES)[number];

/**
 * Strokes traced through a smooth flow field. Sizes are in pixels at a
 * 1080-pixel short side and scale with the output.
 */
export interface InkSpec {
	gen: "ink";
	seed: number;
	style: InkStyle;
	strokes: number;
	/** Field features across the short side. */
	zoom: number;
	/** 0..1: more octaves and a wider turn range. */
	turbulence: number;
	/** Steps each way from a stroke's start. */
	length: number;
	width: number;
	/** Pale strokes on the darkest ink rather than dark strokes on paper. */
	dark: boolean;
	grain: number;
	colors: Colors;
}

export function isInkSpec(v: unknown): v is InkSpec {
	if (!isRecord(v) || v.gen !== "ink") return false;
	return (
		isSeed(v.seed) &&
		INK_STYLES.includes(v.style as InkStyle) &&
		allFinite(v, ["zoom", "turbulence", "width", "grain"]) &&
		Number.isInteger(v.strokes) &&
		(v.strokes as number) >= 1 &&
		(v.strokes as number) <= 10000 &&
		Number.isInteger(v.length) &&
		(v.length as number) >= 2 &&
		(v.length as number) <= 1000 &&
		(v.width as number) > 0 &&
		typeof v.dark === "boolean" &&
		isColors(v.colors)
	);
}
