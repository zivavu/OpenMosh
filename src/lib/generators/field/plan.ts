/**
 * Textures for the height-field generators. Each kind has its own tuned
 * ranges; the domain bend and ramp cycles are dealt across the batch so most
 * images stay flat and plain while a few get a tunnel, a mirror or banding.
 */

import { deal } from "../palette";
import { randIn, randLog, type Rand } from "../rng";
import type { Variety } from "../types";
import type { Domain, FieldKind, FieldSpec } from "./spec";

export type FieldTexture = Omit<FieldSpec, "colors">;

type Params = FieldSpec["params"];

interface Look {
	scale: number;
	params: Params;
	light: [number, number];
	/** Default 0.45–0.75 and 1.0–1.6; smooth fields need less crush. */
	gamma?: [number, number];
	contrast?: [number, number];
	cycles: number;
}

/**
 * Which domain bends suit each kind, from contact sheets: the kaleidoscope's
 * fold shows as a seam through anything smooth and large (plasma, rings), and
 * the tunnel's centre is a smear on plasma — both read as a pattern on the
 * cellular and striped fields.
 */
const DOMAIN_WEIGHTS: Record<FieldKind, [Domain, number][]> = {
	voronoi: [
		[0, 0.6],
		[1, 0.2],
		[2, 0.2],
	],
	stripes: [
		[0, 0.7],
		[1, 0.15],
		[2, 0.15],
	],
	plasma: [[0, 1]],
	rings: [
		[0, 0.85],
		[1, 0.15],
	],
};

/** A random look per kind; `near` reuses another look's structure for cohesion. */
const LOOKS: Record<FieldKind, (rng: Rand, near?: Look) => Look> = {
	voronoi(rng, near) {
		const look = near ? near.params[2] : rng() < 0.4 ? 0 : rng() < 0.6 ? 1 : 2;
		// square-ish metrics facet the smooth blobs; they suit the edged looks
		const metric = near
			? near.params[1]
			: look === 0 || rng() < 0.7
				? 0
				: rng() < 0.5
					? 1
					: 2;
		return {
			scale: near ? near.scale * randLog(rng, 0.8, 1.25) : randLog(rng, 3, 8),
			params: [randIn(rng, 0.6, 1), metric, look, randIn(rng, 0, 1.5)],
			light: [0.6, 2],
			cycles: near ? near.cycles : rng() < 0.8 ? 1 : randIn(rng, 2, 3),
		};
	},
	stripes(rng, near) {
		const hard = near ? near.params[2] : rng() < 0.5 ? 0 : randIn(rng, 0.5, 1);
		return {
			scale: near ? near.scale * randLog(rng, 0.8, 1.25) : randLog(rng, 0.8, 4),
			params: [
				near ? near.params[0] * randLog(rng, 0.8, 1.25) : randLog(rng, 1.5, 12),
				randIn(rng, 0.2, 2.5),
				hard,
				near ? near.params[3] + randIn(rng, -0.3, 0.3) : rng() * Math.PI,
			],
			light: [1, 3],
			cycles: 1,
		};
	},
	plasma(rng, near) {
		return {
			scale: near ? near.scale * randLog(rng, 0.8, 1.25) : randLog(rng, 2, 6),
			params: [
				randIn(rng, 2, 6),
				randIn(rng, 2, 6),
				randIn(rng, 2, 6),
				randIn(rng, 2, 6),
			],
			light: [0.5, 2],
			gamma: [0.7, 1.0],
			contrast: [0.7, 1.1],
			cycles: near
				? near.cycles
				: [1, 1, 1, 1, 1, 2, 2, 2, 3, 5][Math.floor(rng() * 10)],
		};
	},
	rings(rng, near) {
		const centres = near ? near.params[0] : 1 + Math.floor(rng() * 4);
		// One centre on its own is plain concentric circles; give it a wave.
		const lin = centres === 1 || rng() < 0.5 ? randIn(rng, 0.2, 0.6) : 0;
		return {
			scale: near ? near.scale * randLog(rng, 0.8, 1.25) : randLog(rng, 2, 5),
			params: [centres, randIn(rng, 1, 4), randIn(rng, 0, 0.5), lin],
			light: [1, 3],
			cycles: near ? near.cycles : rng() < 0.7 ? 1 : 2,
		};
	},
};

function texture(
	rng: Rand,
	kind: FieldKind,
	look: Look,
	domain: Domain,
): FieldTexture {
	return {
		gen: "field",
		field: kind,
		seed: rng() * 100,
		offset: [randIn(rng, -3, 3), randIn(rng, -3, 3)],
		scale: look.scale,
		domain,
		cycles: look.cycles,
		params: look.params,
		angle: rng() * Math.PI * 2,
		light: randIn(rng, ...look.light),
		contrast: randIn(rng, ...(look.contrast ?? [1.0, 1.6])),
		gamma: randIn(rng, ...(look.gamma ?? [0.45, 0.75])),
		grain: rng() < 0.5 ? 0 : randIn(rng, 0.5, 3),
	};
}

export function planFieldTextures(
	rng: Rand,
	n: number,
	variety: Variety,
	kind: FieldKind,
): FieldTexture[] {
	if (variety === "cohesive") {
		const base = LOOKS[kind](rng);
		const domain = deal(rng, 1, DOMAIN_WEIGHTS[kind])[0];
		return Array.from({ length: n }, () =>
			texture(rng, kind, LOOKS[kind](rng, base), domain),
		);
	}
	const domains = deal(rng, n, DOMAIN_WEIGHTS[kind]);
	return domains.map((domain) => texture(rng, kind, LOOKS[kind](rng), domain));
}
