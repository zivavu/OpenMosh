import type { Colors } from "../palette";
import {
	allFinite,
	isColors,
	isRecord,
	isSeed,
	isTransparentFlag,
} from "../spec-check";

export const CUTOUT_SCENES = ["hills", "tunnel", "islands", "arches"] as const;
export type CutoutScene = (typeof CUTOUT_SCENES)[number];

/**
 * Stacked paper layers with soft shadows. Placement (sun, tunnel centre,
 * islands, arch) and every edge's wobble come from `seed`, in a fixed order.
 */
export interface CutoutSpec {
	gen: "cutout";
	seed: number;
	scene: CutoutScene;
	/** 3 to 14, the backdrop included. */
	layers: number;
	shadow: number;
	wobble: number;
	/** Lightest layer at the front rather than the back. */
	lightFront: boolean;
	grain: number;
	colors: Colors;
	/** No ground: only what is drawn is opaque. Absent on opaque images. */
	transparent?: true;
}

export function isCutoutSpec(v: unknown): v is CutoutSpec {
	if (!isRecord(v) || v.gen !== "cutout") return false;
	return (
		isSeed(v.seed) &&
		CUTOUT_SCENES.includes(v.scene as CutoutScene) &&
		Number.isInteger(v.layers) &&
		(v.layers as number) >= 3 &&
		(v.layers as number) <= 14 &&
		allFinite(v, ["shadow", "wobble", "grain"]) &&
		typeof v.lightFront === "boolean" &&
		isTransparentFlag(v.transparent) &&
		isColors(v.colors)
	);
}
