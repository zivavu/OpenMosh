// What the pen draws in one section of the song: a curve and the symmetric copies it is
// repeated in. Rolled from the seed and the section's number alone.

import { mulberry32, shuffle, type Rand } from "../rng";

/** x' = a·x + b·y + e, y' = c·x + d·y + f. Only rotations, mirrors and shifts. */
export type Copy = readonly [number, number, number, number, number, number];

/** Half of the frame on each axis, where the short side's half is 1. */
export interface Extent {
	x: number;
	y: number;
}

/** A place on the curve that a stroke leaves from. */
export interface Hair {
	x: number;
	y: number;
	/** Where the strokes lean: the curve's normal, turned by the figure's sweep. */
	lean: [number, number];
	/** How far along the whole figure, 0 to 1: when the pen gets here. */
	pen: number;
	/** Its place in the figure's row of strokes, so neighbours curve alike. */
	row: number;
	/** How long this stroke runs: what scallops a figure's outline. */
	reach: number;
	/** How far along the palette. */
	tone: number;
}

export interface Figure {
	name: string;
	seed: number;
	copies: Copy[];
	hairs: Hair[];
}

type Point = [number, number];

interface Plan {
	/** Each strand is a stroke of the pen; between them it lifts. */
	strands: Point[][];
	copies: Copy[];
	/** Which way each strand's strokes lean off the curve. */
	sides?: number[];
}

const TAU = Math.PI * 2;
const CURVE_POINTS = 96;
const ROOT_SCATTER = 0.09;
const IDENTITY: Copy = [1, 0, 0, 1, 0, 0];
const MIRROR_X: Copy = [-1, 0, 0, 1, 0, 0];

const curve = (at: (u: number) => Point): Point[] =>
	Array.from({ length: CURVE_POINTS + 1 }, (_, i) => at(i / CURVE_POINTS));

const polar = (r: number, a: number): Point => [
	r * Math.cos(a),
	r * Math.sin(a),
];

function pick<T>(rng: Rand, list: readonly T[]): T {
	return list[Math.floor(rng() * list.length)];
}

function turns(n: number): Copy[] {
	return Array.from({ length: n }, (_, i) => {
		const c = Math.cos((TAU * i) / n);
		const s = Math.sin((TAU * i) / n);
		return [c, -s, s, c, 0, 0] as const;
	});
}

/** Each turn and its reflection, for a figure with no handedness. */
function turnsAndMirrors(n: number): Copy[] {
	return turns(n).flatMap(([a, b, c, d, e, f]): Copy[] => [
		[a, b, c, d, e, f],
		[-a, b, -c, d, e, f],
	]);
}

function rose(rng: Rand): Plan {
	const n = pick(rng, [3, 4, 5, 6, 8]);
	const radius = 0.55 + rng() * 0.2;
	const span = (TAU / n) * (0.55 + rng() * 0.35);
	const petal = curve((u) =>
		polar(radius * Math.sin(Math.PI * u) ** 0.8, (u - 0.5) * span),
	);
	return { strands: [petal], copies: turnsAndMirrors(n) };
}

function rings(rng: Rand): Plan {
	const n = pick(rng, [2, 3, 4]);
	const count = 2 + Math.floor(rng() * 2);
	const strands: Point[][] = [];
	const sides: number[] = [];
	for (let i = 0; i < count; i++) {
		const radius = 0.26 + (0.5 * (i + 1)) / count;
		strands.push(curve((u) => polar(radius, (u * TAU) / n)));
		sides.push(i % 2 ? -1 : 1);
	}
	return { strands, copies: turns(n), sides };
}

function spiral(rng: Rand): Plan {
	const arms = pick(rng, [2, 3, 5]);
	const sweep = TAU * (0.7 + rng() * 0.6);
	const reach = 0.65 + rng() * 0.15;
	const arm = curve((u) => polar(0.06 + reach * u, u * sweep));
	return { strands: [arm], copies: turns(arms) };
}

function wings(rng: Rand, extent: Extent): Plan {
	const count = 2 + Math.floor(rng() * 2);
	const width = Math.min(extent.x, 1.3) * (0.68 + rng() * 0.12);
	const rise = 0.55 + rng() * 0.2;
	const strands: Point[][] = [];
	for (let i = 0; i < count; i++) {
		const k = 1 - (i * 0.5) / count;
		strands.push(
			curve((u) => {
				const v = 1 - u;
				// A quadratic Bézier: out along the bottom, then up and back in.
				return [
					2 * v * u * width * 1.5 * k + u * u * width * 0.25 * k,
					(v * v - u * u) * -rise * k + 2 * v * u * -0.1,
				];
			}),
		);
	}
	return { strands, copies: [IDENTITY, MIRROR_X] };
}

function arches(rng: Rand): Plan {
	const count = 3 + Math.floor(rng() * 2);
	const foot = -0.7 - rng() * 0.15;
	const strands: Point[][] = [];
	const sides: number[] = [];
	for (let i = 0; i < count; i++) {
		const radius = 0.4 + (i * 0.85) / count;
		strands.push(
			curve((u) => {
				const [x, y] = polar(radius, (Math.PI / 2) * (1 - u));
				return [x, y + foot];
			}),
		);
		sides.push(1);
	}
	return { strands, copies: [IDENTITY, MIRROR_X], sides };
}

function star(rng: Rand): Plan {
	const [n, k] = pick(rng, [
		[5, 2],
		[7, 3],
		[8, 3],
		[9, 4],
	]);
	const r = 0.62 + rng() * 0.13;
	const bow = 0.06 + rng() * 0.14;
	const from = polar(r, 0);
	const to = polar(r, (TAU * k) / n);
	const side: Point = [to[1] - from[1], from[0] - to[0]];
	const chord = curve((u) => {
		const swell = Math.sin(Math.PI * u) * bow;
		return [
			from[0] + (to[0] - from[0]) * u + side[0] * swell,
			from[1] + (to[1] - from[1]) * u + side[1] * swell,
		];
	});
	return { strands: [chord], copies: turns(n) };
}

function waves(rng: Rand, extent: Extent): Plan {
	const count = Math.max(2, Math.round(extent.x * (1.5 + rng())));
	const cycles = 1 + rng();
	const swing = 0.08 + rng() * 0.1;
	const line = curve((u) => [
		Math.sin(u * cycles * TAU) * swing,
		(u * 2 - 1) * extent.y * 0.85,
	]);
	const copies = Array.from({ length: count }, (_, i): Copy => {
		const x = (((i + 0.5) / count) * 2 - 1) * extent.x * 0.8;
		return i % 2 ? [-1, 0, 0, 1, x, 0] : [1, 0, 0, 1, x, 0];
	});
	return { strands: [line], copies };
}

const FAMILIES = {
	Rose: rose,
	Rings: rings,
	Spiral: spiral,
	Wings: wings,
	Arches: arches,
	Star: star,
	Waves: waves,
} satisfies Record<string, (rng: Rand, extent: Extent) => Plan>;

type FamilyName = keyof typeof FAMILIES;

export const FIGURE_NAMES = Object.keys(FAMILIES) as FamilyName[];

function deck(seed: number, round: number): FamilyName[] {
	return shuffle(
		mulberry32((Math.imul(seed + 1, 40503) ^ (round * 0x9e3779b1)) >>> 0),
		[...FIGURE_NAMES],
	);
}

/** Every family comes up once before any comes up again, never the same one twice in a
 * row. */
export function familyOf(seed: number, section: number): FamilyName {
	const size = FIGURE_NAMES.length;
	const round = Math.floor(section / size);
	const order = deck(seed, round);
	const last = round > 0 ? deck(seed, round - 1)[size - 1] : null;
	if (order[0] === last) [order[0], order[1]] = [order[1], order[0]];
	return order[section % size];
}

function strandLength(strand: Point[]) {
	let length = 0;
	for (let i = 1; i < strand.length; i++) {
		length += Math.hypot(
			strand[i][0] - strand[i - 1][0],
			strand[i][1] - strand[i - 1][1],
		);
	}
	return length;
}

function layHairs(
	rng: Rand,
	plan: Plan,
	wanted: number,
	sweep: number,
	scallops: number,
	toneSpread: number,
): Hair[] {
	const perCopy = Math.max(4, Math.round(wanted / plan.copies.length));
	const lengths = plan.strands.map(strandLength);
	const total = lengths.reduce((a, b) => a + b, 0) || 1;
	const hairs: Hair[] = [];
	const c = Math.cos(sweep);
	const s = Math.sin(sweep);
	let walked = 0;
	plan.strands.forEach((strand, index) => {
		const count = Math.max(2, Math.round((perCopy * lengths[index]) / total));
		const side = plan.sides?.[index] ?? 1;
		let segment = 1;
		let reached = 0;
		for (let h = 0; h < count; h++) {
			const target = ((h + 0.5) / count) * lengths[index];
			let piece = 0;
			while (segment < strand.length) {
				const [ax, ay] = strand[segment - 1];
				const [bx, by] = strand[segment];
				piece = Math.hypot(bx - ax, by - ay);
				if (reached + piece >= target || segment === strand.length - 1) break;
				reached += piece;
				segment++;
			}
			const [ax, ay] = strand[segment - 1];
			const [bx, by] = strand[segment];
			const f = piece > 0 ? Math.min(1, (target - reached) / piece) : 0;
			const size = piece || 1;
			const tx = (bx - ax) / size;
			const ty = (by - ay) / size;
			const along = walked + target;
			const pen = along / total;
			// Off the curve a little, or the roots rule a hard edge along it.
			const off = (rng() - 0.5) * ROOT_SCATTER * side;
			hairs.push({
				x: ax + (bx - ax) * f + ty * off,
				y: ay + (by - ay) * f - tx * off,
				lean: [(ty * c + tx * s) * side, (-tx * c + ty * s) * side],
				pen,
				row: hairs.length,
				reach:
					(0.8 + 0.3 * Math.sin(pen * scallops * TAU)) * (0.7 + 0.6 * rng()),
				tone: toneSpread * Math.sin(pen * TAU),
			});
		}
		walked += lengths[index];
	});
	return hairs;
}

const cache = new Map<string, Figure>();
const MAX_CACHED = 32;

/** About `wanted` strokes in all, across its copies. */
export function figureOf(
	seed: number,
	section: number,
	extent: Extent,
	wanted: number,
	toneSpread: number,
): Figure {
	const key = [seed, section, extent.x, extent.y, wanted, toneSpread].join();
	const held = cache.get(key);
	if (held) return held;
	const figureSeed =
		(Math.imul(seed + 1, 2654435761) ^ Math.imul(section + 1, 40503)) >>> 0;
	const rng = mulberry32(figureSeed);
	const name = familyOf(seed, section);
	const plan = FAMILIES[name](rng, extent);
	const sweep = (rng() - 0.5) * 1.6;
	const scallops = 2 + Math.floor(rng() * 5);
	const figure: Figure = {
		name,
		seed: figureSeed,
		copies: plan.copies,
		hairs: layHairs(rng, plan, wanted, sweep, scallops, toneSpread),
	};
	if (cache.size >= MAX_CACHED) cache.clear();
	cache.set(key, figure);
	return figure;
}
