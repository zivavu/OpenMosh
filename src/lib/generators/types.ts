/** Procedural source images. A generated image is a spec, not pixels: the spec
 * is what the app keeps (embedded in the PNG), re-rendered at the needed size. */

import type { AttractorSpec } from "./attractor/spec";
import type { CutoutSpec } from "./cutout/spec";
import type { FieldKind, FieldSpec } from "./field/spec";
import type { GradientSpec } from "./gradient/spec";
import type { InkSpec } from "./ink/spec";

/** One image's recipe, discriminated on `gen`. */
export type GeneratedSpec =
	GradientSpec | FieldSpec | CutoutSpec | AttractorSpec | InkSpec;

export type Variety = "wild" | "cohesive";

/** What a batch is made of: one generator, or a mix dealt across the batch. */
export type GeneratorKind =
	"mix" | "gradient" | FieldKind | "cutout" | "attractor" | "ink";

export interface BatchOptions {
	count: number;
	variety: Variety;
	kind: GeneratorKind;
	/** A named palette to keep every image in, or null for random. */
	palette: string | null;
	/** Leave the ground clear. Only the drawn kinds can; a mix then deals only those. */
	transparent?: boolean;
}

/** PNG tEXt keyword the spec is stored under. */
export const SPEC_KEYWORD = "openmosh-gen";
