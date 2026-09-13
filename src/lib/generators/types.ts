/**
 * Procedural source images. A generated image is a spec, not pixels: the spec
 * is what the app keeps (embedded in the PNG it hands out as a File), and the
 * pixels are re-rendered at whatever size the output turns out to need.
 */

import type { GradientSpec } from "./gradient/spec";

/** One image's recipe. Discriminated on `gen` as more generators arrive. */
export type GeneratedSpec = GradientSpec;

export type Variety = "wild" | "cohesive";

export interface BatchOptions {
	count: number;
	variety: Variety;
	/** A named palette to keep every image in, or null for random. */
	palette: string | null;
}

/** PNG tEXt keyword the spec is stored under. */
export const SPEC_KEYWORD = "openmosh-gen";
