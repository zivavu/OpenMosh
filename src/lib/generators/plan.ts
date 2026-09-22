/** Batch planning: what N images look like *together*. Colours are dealt across
 * the batch (see palette.ts), kinds when mixing; each generator lays out its own. */

import { planFieldTextures } from "./field/plan";
import { FIELD_KINDS } from "./field/spec";
import { planGradientTextures } from "./gradient/plan";
import {
	cohesiveColors,
	deal,
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
type OneKind = Exclude<GeneratorKind, "mix">;

const MIX_WEIGHTS: [OneKind, number][] = [
	["gradient", 0.3],
	["voronoi", 0.2],
	["stripes", 0.2],
	["plasma", 0.15],
	["rings", 0.15],
];

function texturesFor(
	rng: Rand,
	kind: OneKind,
	n: number,
	variety: Variety,
): Texture[] {
	return kind === "gradient"
		? planGradientTextures(rng, n, variety)
		: planFieldTextures(rng, n, variety, kind);
}

export function planBatch(seed: number, opts: BatchOptions): GeneratedSpec[] {
	const rng = mulberry32(seed);
	const n = Math.max(1, opts.count);
	const preset = opts.palette ? PALETTES[opts.palette] : undefined;

	// Which generator fills each slot.
	let kinds: OneKind[];
	if (opts.kind !== "mix") kinds = Array<OneKind>(n).fill(opts.kind);
	else if (opts.variety === "cohesive")
		kinds = Array<OneKind>(n).fill(deal(rng, 1, MIX_WEIGHTS)[0]);
	else kinds = deal(rng, n, MIX_WEIGHTS);

	// Each generator plans its slots as one group, so its own stratification
	// (gradient's mode split, the fields' domains) still holds inside a mix.
	const bySlot: Texture[] = new Array(n);
	for (const kind of ["gradient", ...FIELD_KINDS] as OneKind[]) {
		const slots = kinds.flatMap((k, i) => (k === kind ? [i] : []));
		if (slots.length === 0) continue;
		const textures = texturesFor(rng, kind, slots.length, opts.variety);
		slots.forEach((slot, j) => (bySlot[slot] = textures[j]));
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
