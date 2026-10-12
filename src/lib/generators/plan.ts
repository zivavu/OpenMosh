/** Batch planning: what N images look like *together*. Colours are dealt across
 * the batch (see palette.ts), kinds when mixing; each generator lays out its own. */

import { planAttractorTextures } from "./attractor/plan";
import { planCutoutTextures } from "./cutout/plan";
import { planFieldTextures } from "./field/plan";
import {
	PLANNED_FIELDS,
	type FieldKind,
	type PlannedField,
} from "./field/spec";
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
	...PLANNED_FIELDS,
	"cutout",
	"attractor",
	"ink",
];

const MIX_WEIGHTS: [OneKind, number][] = [
	["gradient", 0.25],
	["plasma", 0.15],
	["rings", 0.15],
	["cutout", 0.15],
	["attractor", 0.15],
	["ink", 0.15],
];

/** The kinds that draw onto a ground, so can leave it clear. */
export const DRAWN_KINDS: OneKind[] = ["cutout", "attractor", "ink"];

/** Whether a spec renders with a clear ground (and so must stay PNG). */
export function isTransparentSpec(spec: GeneratedSpec): boolean {
	return "transparent" in spec && spec.transparent === true;
}

/** Which panel choice a spec belongs to; a saved image can be a retired field. */
export function specKind(spec: GeneratedSpec): OneKind | FieldKind {
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
			return planFieldTextures(rng, n, variety, kind as PlannedField);
	}
}

/**
 * Each generator plans its slots as one group, so its own stratification
 * (gradient's mode split, the fields' domains) still holds inside a mix.
 */
function planSlots(
	rng: Rand,
	kinds: OneKind[],
	variety: Variety,
	into: Texture[],
) {
	for (const kind of ONE_KINDS) {
		const slots = kinds.flatMap((k, i) => (k === kind ? [i] : []));
		if (slots.length === 0) continue;
		const textures = texturesFor(rng, kind, slots.length, variety);
		slots.forEach((slot, j) => (into[slot] = textures[j]));
	}
}

const isDrawn = (k: OneKind) => DRAWN_KINDS.includes(k);

export function planBatch(seed: number, opts: BatchOptions): GeneratedSpec[] {
	const rng = mulberry32(seed);
	const n = Math.max(1, opts.count);
	const preset = opts.palette ? PALETTES[opts.palette] : undefined;

	// Which generator fills each slot.
	let kinds: OneKind[];
	if (opts.kind !== "mix") kinds = Array<OneKind>(n).fill(opts.kind);
	else if (opts.variety === "cohesive")
		kinds = Array<OneKind>(n).fill(pickWeighted(rng, MIX_WEIGHTS));
	else kinds = deal(rng, n, MIX_WEIGHTS);

	const bySlot: Texture[] = new Array(n);
	planSlots(rng, kinds, opts.variety, bySlot);

	// A transparent mix is the solid one with its field slots re-dealt to drawn
	// kinds from a stream of their own, so flipping the background keeps every
	// drawn image and every colour where it was.
	if (opts.transparent && opts.kind === "mix") {
		const swap = mulberry32(seed ^ 0x5bd1e995);
		const drawnWeights = MIX_WEIGHTS.filter(([k]) => isDrawn(k));
		const swapped = kinds.flatMap((k, i) => (isDrawn(k) ? [] : [i]));
		const fresh =
			opts.variety === "cohesive"
				? Array<OneKind>(swapped.length).fill(pickWeighted(swap, drawnWeights))
				: deal(swap, swapped.length, drawnWeights);
		const replaced: Texture[] = new Array(swapped.length);
		planSlots(swap, fresh, opts.variety, replaced);
		swapped.forEach((slot, j) => {
			kinds[slot] = fresh[j];
			bySlot[slot] = replaced[j];
		});
	}
	if (opts.transparent)
		kinds.forEach((k, i) => {
			if (isDrawn(k))
				bySlot[i] = { ...bySlot[i], transparent: true } as Texture;
		});

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
