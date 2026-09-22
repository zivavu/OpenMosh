/** Procedural source images. A generated image is a spec, not pixels: the spec
 * is what the app keeps (embedded in the PNG), re-rendered at the needed size. */

import type { FieldKind, FieldSpec } from "./field/spec";
import type { GradientSpec } from "./gradient/spec";

/** One image's recipe, discriminated on `gen`. */
export type GeneratedSpec = GradientSpec | FieldSpec;

export type Variety = "wild" | "cohesive";

/** What a batch is made of: one generator, or a mix dealt across the batch. */
export type GeneratorKind = "mix" | "gradient" | FieldKind;

export interface BatchOptions {
	count: number;
	variety: Variety;
	kind: GeneratorKind;
	/** A named palette to keep every image in, or null for random. */
	palette: string | null;
}

/** PNG tEXt keyword the spec is stored under. */
export const SPEC_KEYWORD = "openmosh-gen";
