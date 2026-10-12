/** Batch planning: what N images look like *together*. Colours are dealt across
 * the batch (see palette.ts), kinds when mixing; each generator lays out its own. */

import { planAttractorTextures } from "./attractor/plan";
import { planCutoutTextures } from "./cutout/plan";
import { planFieldTextures } from "./field/plan";
import { FIELD_KINDS, type FieldKind } from "./field/spec";
import { planGradientTextures } from "./gradient/plan";
import { planInkTextures } from "./ink/plan";
import {
	cohesiveColors,
	deal,
	pickWeighted,
	orderByHue,
	PALETTES,
	wildColors,
} from "./palette";
import { mulberry32, type Rand } from "../rng";
import type {
	BatchOptions,
	GeneratedSpec,
	GeneratorKind,
	Variety,
} from "./types";

type Texture = Omit<GeneratedSpec, "colors">;
export type OneKind = Exclude<GeneratorKind, "mix">;

/** Every single-generator kind, in the order a mix plans them. */
export const ONE_KINDS: OneKind[] = [
	"gradient",
	...FIELD_KINDS,
	"cutout",
	"attractor",
	"ink",
];

const MIX_WEIGHTS: [OneKind, number][] = [
	["gradient", 0.22],
	["voronoi", 0.14],
	["stripes", 0.14],
	["plasma", 0.1],
	["rings", 0.1],
	["cutout", 0.1],
	["attractor", 0.1],
	["ink", 0.1],
];

/** The kinds that draw onto a ground, so can leave it clear. */
export const DRAWN_KINDS: OneKind[] = ["cutout", "attractor", "ink"];

/** Whether a spec renders with a clear ground (and so must stay PNG). */
export function isTransparentSpec(spec: GeneratedSpec): boolean {
	return "transparent" in spec && spec.transparent === true;
}

/** Which panel choice a spec belongs to. */
export function specKind(spec: GeneratedSpec): OneKind {
	return spec.gen === "field" ? spec.field : spec.gen;
}

function texturesFor(
	rng: Rand,
	kind: OneKind,
	n: number,
	variety: Variety,
): Texture[] {
	switch (kind) {
		case "gradient":
			return planGradientTextures(rng, n, variety);
		case "cutout":
			return planCutoutTextures(rng, n, variety);
		case "attractor":
			return planAttractorTextures(rng, n, variety);
		case "ink":
			return planInkTextures(rng, n, variety);
		default:
			return planFieldTextures(rng, n, variety, kind as FieldKind);
	}
}

export function planBatch(seed: number, opts: BatchOptions): GeneratedSpec[] {
	const rng = mulberry32(seed);
	const n = Math.max(1, opts.count);
	const preset = opts.palette ? PALETTES[opts.palette] : undefined;

	// Which generator fills each slot.
	const weights = opts.transparent
		? MIX_WEIGHTS.filter(([k]) => DRAWN_KINDS.includes(k))
		: MIX_WEIGHTS;
	let kinds: OneKind[];
	if (opts.kind !== "mix") kinds = Array<OneKind>(n).fill(opts.kind);
	else if (opts.variety === "cohesive")
		kinds = Array<OneKind>(n).fill(pickWeighted(rng, weights));
	else kinds = deal(rng, n, weights);

	// Each generator plans its slots as one group, so its own stratification
	// (gradient's mode split, the fields' domains) still holds inside a mix.
	const bySlot: Texture[] = new Array(n);
	for (const kind of ONE_KINDS) {
		const slots = kinds.flatMap((k, i) => (k === kind ? [i] : []));
		if (slots.length === 0) continue;
		const textures = texturesFor(rng, kind, slots.length, opts.variety);
		const clear = opts.transparent && DRAWN_KINDS.includes(kind);
		slots.forEach(
			(slot, j) =>
				(bySlot[slot] = clear
					? ({ ...textures[j], transparent: true } as Texture)
					: textures[j]),
		);
	}

	if (opts.variety === "cohesive") {
		const colors = cohesiveColors(rng, n, preset);
		return bySlot.map((t, i) => ({ ...t, colors: colors[i] }) as GeneratedSpec);
	}
	const colors = wildColors(rng, n, preset);
	const specs = bySlot.map(
		(t, i) => ({ ...t, colors: colors[i].colors }) as GeneratedSpec,
	);
	return preset
		? specs
		: orderByHue(
				specs,
				colors.map((c) => c.hue),
			);
}
