/** Procedural source images. A generated image is a spec, not pixels: the spec
 * is what the app keeps (embedded in the PNG), re-rendered at the needed size. */

import type { AttractorSpec } from "./attractor/spec";
import type { CutoutSpec } from "./cutout/spec";
import type { FieldSpec, PlannedField } from "./field/spec";
import type { GradientSpec } from "./gradient/spec";
import type { InkSpec } from "./ink/spec";

/** One image's recipe, discriminated on `gen`. */
export type GeneratedSpec =
	GradientSpec | FieldSpec | CutoutSpec | AttractorSpec | InkSpec;

export type Variety = "wild" | "cohesive";

/** What a batch is made of: one generator, or a mix dealt across the batch. */
export type GeneratorKind =
	"mix" | "gradient" | PlannedField | "cutout" | "attractor" | "ink";

export type OneKind = Exclude<GeneratorKind, "mix">;

export interface BatchOptions {
	count: number;
	variety: Variety;
	/** A non-empty list deals evenly across those kinds, even in a cohesive batch. */
	kind: GeneratorKind | OneKind[];
	/** A named palette to keep every image in, or null for random. */
	palette: string | null;
	/** Leave the ground clear. Only the drawn kinds can: a mix then deals only those,
	 * and a list keeps its other kinds solid. */
	transparent?: boolean;
	/** Plan this many and keep the first `count`, so with one seed a smaller batch
	 * is the start of a larger one. */
	nest?: number;
}

/** PNG tEXt keyword the spec is stored under. */
export const SPEC_KEYWORD = "openmosh-gen";
