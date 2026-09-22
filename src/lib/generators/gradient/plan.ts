/** Textures for the gradient generator. Mode and scale are dealt in fixed proportions. */

import { deal } from "../palette";
import { randIn, randLog, type Rand } from "../../rng";
import type { Variety } from "../types";
import type { GradientSpec } from "./spec";

export type GradientTexture = Omit<GradientSpec, "colors">;

/** Where each mode has something to look at: flow turns to noise above scale ~3. */
const SCALE_RANGE: Record<0 | 1, [number, number]> = {
	0: [0.8, 2.5],
	1: [2.5, 8],
};
const WARP_RANGE: Record<0 | 1, [number, number]> = {
	0: [2.5, 6],
	1: [3, 7],
};

function randomScale(rng: Rand, mode: 0 | 1): number {
	return randLog(rng, ...SCALE_RANGE[mode]);
}

function texture(rng: Rand, mode: 0 | 1, scale: number): GradientTexture {
	return {
		gen: "gradient",
		seed: rng() * 100,
		mode,
		offset: [randIn(rng, -5, 5), randIn(rng, -5, 5)],
		scale,
		warp: randIn(rng, ...WARP_RANGE[mode]),
		angle: rng() * Math.PI * 2,
		light: randIn(rng, 1.2, 4),
		spread: 0.6,
		thresh: 0,
		soft: 0.01,
		contrast: randIn(rng, 1.0, 1.6),
		gamma: randIn(rng, 0.45, 0.75),
		grain: rng() < 0.5 ? 0 : randIn(rng, 0.5, 3),
	};
}

export function planGradientTextures(
	rng: Rand,
	n: number,
	variety: Variety,
): GradientTexture[] {
	if (variety === "cohesive") {
		// One mode and one neighbourhood of scale; seed and pan carry the change.
		const mode: 0 | 1 = rng() < 0.4 ? 1 : 0;
		const base = randomScale(rng, mode);
		return Array.from({ length: n }, () =>
			texture(rng, mode, base * randLog(rng, 0.7, 1.4)),
		);
	}
	const modes = deal<0 | 1>(rng, n, [
		[1, 0.4],
		[0, 0.6],
	]);
	return modes.map((mode) => texture(rng, mode, randomScale(rng, mode)));
}
