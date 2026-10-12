import type { Colors } from "../palette";
import { allFinite, isColors, isRecord, isSeed } from "../spec-check";

export const ATTRACTOR_SYSTEMS = ["clifford", "dejong", "flame"] as const;
export type AttractorSystem = (typeof ATTRACTOR_SYSTEMS)[number];

/**
 * Points from a strange attractor or fractal flame, piled into a density
 * buffer and tone-mapped. The system's coefficients are searched from `seed`.
 */
export interface AttractorSpec {
	gen: "attractor";
	seed: number;
	system: AttractorSystem;
	/** Points per output pixel, so every size looks equally filled. */
	density: number;
	exposure: number;
	gamma: number;
	/** Rotational copies, 1 for none. */
	symmetry: number;
	glow: number;
	/** Dark filaments on the lightest ink instead of light on the darkest. */
	light: boolean;
	colors: Colors;
}

export function isAttractorSpec(v: unknown): v is AttractorSpec {
	if (!isRecord(v) || v.gen !== "attractor") return false;
	return (
		isSeed(v.seed) &&
		ATTRACTOR_SYSTEMS.includes(v.system as AttractorSystem) &&
		allFinite(v, ["density", "exposure", "gamma", "glow"]) &&
		(v.density as number) > 0 &&
		(v.gamma as number) > 0 &&
		Number.isInteger(v.symmetry) &&
		(v.symmetry as number) >= 1 &&
		(v.symmetry as number) <= 12 &&
		typeof v.light === "boolean" &&
		isColors(v.colors)
	);
}
