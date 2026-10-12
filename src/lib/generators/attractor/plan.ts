import { deal } from "../palette";
import { randIn, randLog, type Rand } from "../../rng";
import type { Variety } from "../types";
import type { AttractorSpec, AttractorSystem } from "./spec";

export type AttractorTexture = Omit<AttractorSpec, "colors">;

const SYSTEM_WEIGHTS: [AttractorSystem, number][] = [
	["flame", 0.5],
	["clifford", 0.25],
	["dejong", 0.25],
];

function texture(
	rng: Rand,
	system: AttractorSystem,
	near?: AttractorTexture,
): AttractorTexture {
	return {
		gen: "attractor",
		seed: Math.floor(rng() * 2 ** 32),
		system,
		density: randLog(rng, 3, 8),
		exposure: randIn(rng, 1.1, 1.9),
		gamma: randIn(rng, 1.8, 2.8),
		symmetry: near
			? near.symmetry
			: rng() < 0.7
				? 1
				: 2 + Math.floor(rng() * 5),
		glow: randIn(rng, 0.2, 0.6),
		light: near ? near.light : rng() < 0.15,
	};
}

export function planAttractorTextures(
	rng: Rand,
	n: number,
	variety: Variety,
): AttractorTexture[] {
	if (variety === "cohesive") {
		const base = texture(rng, deal(rng, 1, SYSTEM_WEIGHTS)[0]);
		return Array.from({ length: n }, () => texture(rng, base.system, base));
	}
	return deal(rng, n, SYSTEM_WEIGHTS).map((system) => texture(rng, system));
}
