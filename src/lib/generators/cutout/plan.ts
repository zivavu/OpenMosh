import { deal } from "../palette";
import { randIn, shuffle, type Rand } from "../../rng";
import type { Variety } from "../types";
import { CUTOUT_SCENES, type CutoutScene, type CutoutSpec } from "./spec";

export type CutoutTexture = Omit<CutoutSpec, "colors">;

function texture(
	rng: Rand,
	scene: CutoutScene,
	near?: CutoutTexture,
): CutoutTexture {
	return {
		gen: "cutout",
		seed: Math.floor(rng() * 2 ** 32),
		scene,
		layers: near
			? Math.min(14, Math.max(4, near.layers + Math.round(randIn(rng, -1, 1))))
			: Math.round(randIn(rng, 5, 10)),
		shadow: near ? near.shadow : randIn(rng, 0.4, 0.85),
		wobble: randIn(rng, 0.3, 0.8),
		lightFront: near ? near.lightFront : rng() < 0.7,
		grain: rng() < 0.4 ? 0 : randIn(rng, 1, 3),
	};
}

export function planCutoutTextures(
	rng: Rand,
	n: number,
	variety: Variety,
): CutoutTexture[] {
	if (variety === "cohesive") {
		const base = texture(rng, CUTOUT_SCENES[Math.floor(rng() * 4)]);
		return Array.from({ length: n }, () => texture(rng, base.scene, base));
	}
	const scenes = deal<CutoutScene>(
		rng,
		n,
		shuffle(rng, [...CUTOUT_SCENES]).map((s) => [s, 1]),
	);
	return scenes.map((scene) => texture(rng, scene));
}
