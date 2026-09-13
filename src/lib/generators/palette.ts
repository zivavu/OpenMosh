/**
 * Colour ramps shared by every generator: a five-stop ramp with lightness
 * climbing dark→bright, hue drifting smoothly and saturation peaking in the
 * midtones — the structure all the good presets share.
 */

import { randIn, shuffle, type Rand } from "./rng";

export type Colors = [string, string, string, string, string];

export const PALETTES: Record<string, Colors> = {
	Magma: ["#000000", "#5c0026", "#e8197a", "#ff6a1a", "#ffd23a"],
	Cyan: ["#000208", "#062b3d", "#0fb6c6", "#7df0d0", "#eafff6"],
	Ember: ["#040000", "#3a0a02", "#c2320a", "#ff8a1e", "#ffe27a"],
	Iris: ["#02000a", "#1e0a4a", "#6a36d9", "#c46bff", "#f3e6ff"],
	Lime: ["#020600", "#143a06", "#5cba1a", "#b6f02a", "#f2ffd0"],
	Mono: ["#000000", "#222222", "#777777", "#cccccc", "#ffffff"],
};

const GOLDEN_ANGLE = 137.508;

/** h in degrees, s & l in 0..1 */
export function hslHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	const to = (x: number) =>
		Math.round(Math.max(0, Math.min(1, x)) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export type HueStrategy = "analogous" | "sweep" | "complement";

/** The shape of a ramp, separate from the hue it sits on. */
export interface RampShape {
	hueSpread: number;
	ease: number;
	lDark: number;
	lLight: number;
	satPeak: number;
	satEnds: number;
	/** The near-black first stop's own saturation. */
	sat0: number;
	l0: number;
}

export function rampShape(
	rng: Rand,
	strategy: HueStrategy,
	lightness: number,
	mono: boolean,
): RampShape {
	const dir = rng() < 0.5 ? -1 : 1;
	const hueSpread =
		strategy === "analogous"
			? randIn(rng, -45, 45)
			: strategy === "sweep"
				? dir * randIn(rng, 60, 140)
				: dir * randIn(rng, 150, 200);
	const maxL = 0.15 + (lightness / 100) * 0.75;
	const satScale = mono ? randIn(rng, 0.05, 0.2) : 1;
	return {
		hueSpread,
		ease: randIn(rng, 0.75, 1.7),
		lDark: randIn(rng, 0.02, 0.08),
		lLight: randIn(rng, maxL * 0.75, maxL),
		satPeak: randIn(rng, 0.65, 0.95) * satScale,
		satEnds: randIn(rng, 0.25, 0.5) * satScale,
		sat0: randIn(rng, 0.5, 0.9) * satScale,
		l0: randIn(rng, 0.01, 0.05),
	};
}

export function makeRamp(baseHue: number, r: RampShape): Colors {
	const N = 5;
	return Array.from({ length: N }, (_, i) => {
		const t = i / (N - 1);
		const te = t ** r.ease;
		const h = baseHue + r.hueSpread * te;
		const l = i === 0 ? r.l0 : r.lDark + (r.lLight - r.lDark) * te;
		const s =
			i === 0
				? r.sat0
				: r.satEnds + (r.satPeak - r.satEnds) * Math.sin(Math.PI * t);
		return hslHex(h, s, l);
	}) as Colors;
}

/** Deal `n` slots into buckets by weight, shuffled so runs don't form. */
export function deal<T>(rng: Rand, n: number, weights: [T, number][]): T[] {
	const total = weights.reduce((s, [, w]) => s + w, 0);
	const out: T[] = [];
	let acc = 0;
	weights.forEach(([v, w], i) => {
		acc += w;
		const upto = i === weights.length - 1 ? n : Math.round((acc / total) * n);
		while (out.length < upto) out.push(v);
	});
	return shuffle(rng, out);
}

/**
 * Colours for a wild batch: hues step around the wheel by the golden angle so
 * any N covers it evenly, and the ramp shapes are dealt in fixed proportions.
 */
export function wildColors(
	rng: Rand,
	n: number,
	preset: Colors | undefined,
): { colors: Colors; hue: number }[] {
	const h0 = rng() * 360;
	const strategies = deal<HueStrategy>(rng, n, [
		["analogous", 0.35],
		["sweep", 0.45],
		["complement", 0.2],
	]);
	const lightness = deal(rng, n, [
		["dark", 0.25],
		["bright", 0.75],
	]);
	const monos = deal(rng, n, [
		[true, 0.1],
		[false, 0.9],
	]);
	return Array.from({ length: n }, (_, i) => {
		const hue = h0 + i * GOLDEN_ANGLE;
		const light =
			lightness[i] === "dark" ? randIn(rng, 35, 55) : randIn(rng, 55, 95);
		const colors =
			preset ?? makeRamp(hue, rampShape(rng, strategies[i], light, monos[i]));
		return { colors, hue };
	});
}

/** One ramp for a cohesive batch, with the hue nudged a little per image. */
export function cohesiveColors(
	rng: Rand,
	n: number,
	preset: Colors | undefined,
): Colors[] {
	const baseHue = rng() * 360;
	const strategies: HueStrategy[] = ["analogous", "sweep", "complement"];
	const shape = rampShape(
		rng,
		strategies[Math.floor(rng() * strategies.length)],
		randIn(rng, 40, 90),
		rng() < 0.1,
	);
	return Array.from(
		{ length: n },
		() => preset ?? makeRamp(baseHue + randIn(rng, -10, 10), shape),
	);
}

/** Reorder so consecutive entries sit far apart on the hue wheel. */
export function orderByHue<T>(items: T[], hues: number[]): T[] {
	if (items.length < 3) return items;
	const left = items.map((_, i) => i);
	const out = [left.shift()!];
	while (left.length) {
		const prev = hues[out[out.length - 1]];
		let best = 0;
		let bestD = -1;
		left.forEach((i, at) => {
			const d = Math.abs((((hues[i] - prev) % 360) + 540) % 360) - 180;
			const dist = Math.abs(d);
			if (dist > bestD) {
				bestD = dist;
				best = at;
			}
		});
		out.push(left.splice(best, 1)[0]);
	}
	return out.map((i) => items[i]);
}
