/**
 * Batch planning: the part that decides what N gradients look like *together*.
 * Drawing every knob independently gives "samey with the odd ugly one", so the
 * axes people actually notice — hue, mode, lightness — are dealt out in fixed
 * proportions and shuffled, and hues step around the wheel by the golden angle
 * so any N covers it evenly. The shader's blob mask is left off: a cut-out on
 * black reads as a missing image once the effects hit it.
 */

import { mulberry32, pick, randIn, randLog, shuffle, type Rand } from "../rng";
import type { BatchOptions } from "../types";
import type { GradientSpec } from "./spec";

export const GRADIENT_PALETTES: Record<string, GradientSpec["colors"]> = {
	Magma: ["#000000", "#5c0026", "#e8197a", "#ff6a1a", "#ffd23a"],
	Cyan: ["#000208", "#062b3d", "#0fb6c6", "#7df0d0", "#eafff6"],
	Ember: ["#040000", "#3a0a02", "#c2320a", "#ff8a1e", "#ffe27a"],
	Iris: ["#02000a", "#1e0a4a", "#6a36d9", "#c46bff", "#f3e6ff"],
	Lime: ["#020600", "#143a06", "#5cba1a", "#b6f02a", "#f2ffd0"],
	Mono: ["#000000", "#222222", "#777777", "#cccccc", "#ffffff"],
};

const GOLDEN_ANGLE = 137.508;

/** h in degrees, s & l in 0..1 */
function hslHex(h: number, s: number, l: number): string {
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

type HueStrategy = "analogous" | "sweep" | "complement";

/** The shape of a ramp, separate from the hue it sits on. */
interface RampShape {
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

function rampShape(
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

/** A coherent five-stop ramp: lightness climbs dark→bright, hue drifts
 * smoothly, saturation peaks in the midtones. */
function makeRamp(baseHue: number, r: RampShape): GradientSpec["colors"] {
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
	}) as GradientSpec["colors"];
}

/** Deal `n` slots into buckets by weight, shuffled so runs don't form. */
function deal<T>(rng: Rand, n: number, weights: [T, number][]): T[] {
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

interface Look {
	mode: 0 | 1;
	scale: number;
}

function texture(rng: Rand, look: Look): Omit<GradientSpec, "gen" | "colors"> {
	return {
		seed: rng() * 100,
		mode: look.mode,
		offset: [randIn(rng, -5, 5), randIn(rng, -5, 5)],
		scale: look.scale,
		warp: look.mode === 1 ? randIn(rng, 1, 4) : randIn(rng, 0.5, 6),
		angle: rng() * Math.PI * 2,
		light: randIn(rng, 0.6, 3.5),
		spread: 0.6,
		thresh: 0,
		soft: 0.01,
		contrast: randIn(rng, 1.0, 1.7),
		gamma: randIn(rng, 0.8, 1.4),
		grain: rng() < 0.5 ? 0 : randIn(rng, 0.5, 3),
	};
}

/** Reorder so consecutive images sit far apart on the hue wheel. */
function orderByHue(specs: GradientSpec[], hues: number[]): GradientSpec[] {
	if (specs.length < 3) return specs;
	const left = specs.map((_, i) => i);
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
	return out.map((i) => specs[i]);
}

export function planGradientBatch(
	seed: number,
	opts: BatchOptions,
): GradientSpec[] {
	const rng = mulberry32(seed);
	const n = Math.max(1, opts.count);
	const preset = opts.palette ? GRADIENT_PALETTES[opts.palette] : undefined;
	return opts.variety === "cohesive"
		? planCohesive(rng, n, preset)
		: planWild(rng, n, preset);
}

function planWild(
	rng: Rand,
	n: number,
	preset: GradientSpec["colors"] | undefined,
): GradientSpec[] {
	const h0 = rng() * 360;
	const strategies = deal<HueStrategy>(rng, n, [
		["analogous", 0.5],
		["sweep", 0.35],
		["complement", 0.15],
	]);
	const lightness = deal(rng, n, [
		["dark", 0.25],
		["bright", 0.75],
	]);
	const monos = deal(rng, n, [
		[true, 0.1],
		[false, 0.9],
	]);
	const modes = deal<0 | 1>(rng, n, [
		[1, 0.4],
		[0, 0.6],
	]);
	const hues: number[] = [];
	const specs = Array.from({ length: n }, (_, i): GradientSpec => {
		const hue = h0 + i * GOLDEN_ANGLE;
		hues.push(hue);
		const light =
			lightness[i] === "dark" ? randIn(rng, 15, 40) : randIn(rng, 45, 95);
		const colors =
			preset ?? makeRamp(hue, rampShape(rng, strategies[i], light, monos[i]));
		return {
			gen: "gradient",
			colors,
			...texture(rng, {
				mode: modes[i],
				scale: randLog(rng, 0.6, 12),
			}),
		};
	});
	return preset ? specs : orderByHue(specs, hues);
}

function planCohesive(
	rng: Rand,
	n: number,
	preset: GradientSpec["colors"] | undefined,
): GradientSpec[] {
	const baseHue = rng() * 360;
	const shape = rampShape(
		rng,
		pick(rng, ["analogous", "sweep", "complement"] as const),
		randIn(rng, 30, 90),
		rng() < 0.1,
	);
	const mode: 0 | 1 = rng() < 0.4 ? 1 : 0;
	const baseScale = randLog(rng, 0.8, 8);
	return Array.from({ length: n }, (): GradientSpec => {
		const colors = preset ?? makeRamp(baseHue + randIn(rng, -10, 10), shape);
		return {
			gen: "gradient",
			colors,
			...texture(rng, {
				mode,
				scale: baseScale * randLog(rng, 0.6, 1.6),
			}),
		};
	});
}
