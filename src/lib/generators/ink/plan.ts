import { deal } from "../palette";
import { randIn, randLog, type Rand } from "../../rng";
import type { Variety } from "../types";
import type { InkSpec, InkStyle } from "./spec";

export type InkTexture = Omit<InkSpec, "colors">;

const STYLE_WEIGHTS: [InkStyle, number][] = [
	["strands", 0.55],
	["brush", 0.45],
];

function texture(rng: Rand, style: InkStyle, near?: InkTexture): InkTexture {
	const brush = style === "brush";
	return {
		gen: "ink",
		seed: Math.floor(rng() * 2 ** 32),
		style,
		strokes: Math.round(
			brush ? randIn(rng, 600, 1500) : randIn(rng, 900, 2500),
		),
		zoom: near ? near.zoom * randLog(rng, 0.8, 1.25) : randLog(rng, 0.8, 3),
		turbulence: near ? near.turbulence : randIn(rng, 0, 0.6),
		length: Math.round(randIn(rng, 80, 260)),
		width: brush ? randIn(rng, 4, 14) : randIn(rng, 2, 6),
		dark: near ? near.dark : rng() < 0.4,
		grain: rng() < 0.4 ? 0 : randIn(rng, 1, 2.5),
	};
}

export function planInkTextures(
	rng: Rand,
	n: number,
	variety: Variety,
): InkTexture[] {
	if (variety === "cohesive") {
		const base = texture(rng, deal(rng, 1, STYLE_WEIGHTS)[0]);
		return Array.from({ length: n }, () => texture(rng, base.style, base));
	}
	return deal(rng, n, STYLE_WEIGHTS).map((style) => texture(rng, style));
}
