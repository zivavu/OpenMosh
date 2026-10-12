// Shared pieces for the generator lab: the generator contract, palettes,
// colour maths, seeded noise and a few drawing helpers.

import { mulberry32, randIn, shuffle, type Rand } from "../../src/lib/rng";
import {
	PALETTES,
	wildColors,
	type Colors,
} from "../../src/lib/generators/palette";

export { mulberry32, randIn, shuffle, type Rand, type Colors };

export const TAU = Math.PI * 2;

export type Param =
	| {
			key: string;
			label: string;
			type: "range";
			min: number;
			max: number;
			step?: number;
			value: number;
	  }
	| {
			key: string;
			label: string;
			type: "select";
			options: string[];
			value: string;
	  }
	| { key: string; label: string; type: "bool"; value: boolean };

export type Values = Record<string, number | string | boolean>;

export interface Env {
	ctx: CanvasRenderingContext2D;
	w: number;
	h: number;
	/** Short side in pixels. */
	u: number;
	/** u / 1080, for sizes tuned at 1080p. */
	s: number;
	rng: Rand;
	seed: number;
	/** Five stops, dark to light. */
	inks: Colors;
}

export interface Generator {
	id: string;
	name: string;
	group: string;
	blurb: string;
	params: Param[];
	render(env: Env, p: Values): void;
}

/** Extra ink sets for the lab, alongside the app's named ramps. */
export const LAB_PALETTES: Record<string, Colors> = {
	Riso: ["#1d1a3a", "#0078bf", "#ff48b0", "#ffe800", "#f3eee3"],
	Bauhaus: ["#151515", "#1d4ea3", "#e0301e", "#f2b705", "#efe9dc"],
	Memphis: ["#1b1b1b", "#00a7a7", "#ff5ca8", "#ffd23f", "#fff6e5"],
	Broadcast: ["#05060a", "#2b2fd9", "#e0206b", "#18c9b0", "#f0f0f0"],
	Terminal: ["#020502", "#0b3d1a", "#1fa34a", "#7dff9a", "#e8ffe8"],
	Sunset: ["#140a1f", "#5b1a5e", "#e0475b", "#ff9e5e", "#ffe9c2"],
};

export const PALETTE_NAMES = [
	"Random",
	...Object.keys(LAB_PALETTES),
	...Object.keys(PALETTES),
];

export function paletteFor(name: string, seed: number): Colors {
	if (LAB_PALETTES[name]) return LAB_PALETTES[name];
	if (PALETTES[name]) return PALETTES[name];
	return wildColors(mulberry32(seed ^ 0x9e3779b9), 1, undefined)[0].colors;
}

export type RGB = [number, number, number];

export function hexRgb(hex: string): RGB {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function css([r, g, b]: RGB, a = 1): string {
	return a >= 1
		? `rgb(${r | 0},${g | 0},${b | 0})`
		: `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function withAlpha(hex: string, a: number): string {
	return css(hexRgb(hex), a);
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
	return [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	];
}

export function mixHex(a: string, b: string, t: number): string {
	return css(mixRgb(hexRgb(a), hexRgb(b), t));
}

export function luma(hex: string): number {
	const [r, g, b] = hexRgb(hex);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** t in 0..1 across the five stops. */
export function ramp(inks: Colors): (t: number) => RGB {
	const stops = inks.map(hexRgb);
	return (t) => {
		const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
		const i = Math.min(Math.floor(x), stops.length - 2);
		return mixRgb(stops[i], stops[i + 1], x - i);
	};
}

export function pick<T>(rng: Rand, arr: readonly T[]): T {
	return arr[Math.floor(rng() * arr.length)];
}

export function int(rng: Rand, lo: number, hi: number): number {
	return lo + Math.floor(rng() * (hi - lo + 1));
}

export function clamp(x: number, lo = 0, hi = 1): number {
	return x < lo ? lo : x > hi ? hi : x;
}

/** Seeded 2D gradient noise, roughly -1..1. */
export function makeNoise(rng: Rand): (x: number, y: number) => number {
	const p = shuffle(
		rng,
		Array.from({ length: 256 }, (_, i) => i),
	);
	const perm = new Uint8Array(512);
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
	const gx = new Float32Array(256);
	const gy = new Float32Array(256);
	for (let i = 0; i < 256; i++) {
		const a = rng() * TAU;
		gx[i] = Math.cos(a);
		gy[i] = Math.sin(a);
	}
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	return (x, y) => {
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const xf = x - xi;
		const yf = y - yi;
		const X = xi & 255;
		const Y = yi & 255;
		const g = (ix: number, iy: number, dx: number, dy: number) => {
			const k = perm[ix + perm[iy]];
			return gx[k] * dx + gy[k] * dy;
		};
		const u = fade(xf);
		const v = fade(yf);
		const a = g(X, Y, xf, yf) + (g(X + 1, Y, xf - 1, yf) - g(X, Y, xf, yf)) * u;
		const b =
			g(X, Y + 1, xf, yf - 1) +
			(g(X + 1, Y + 1, xf - 1, yf - 1) - g(X, Y + 1, xf, yf - 1)) * u;
		return (a + (b - a) * v) * 1.41;
	};
}

export function fbm(
	noise: (x: number, y: number) => number,
	x: number,
	y: number,
	octaves = 3,
): number {
	let v = 0;
	let a = 0.6;
	for (let i = 0; i < octaves; i++) {
		v += a * noise(x, y);
		const nx = x * 1.7 + y * 1.1 + 13.1;
		y = y * 1.7 - x * 1.1 + 7.3;
		x = nx;
		a *= 0.5;
	}
	return v;
}

/** Monochrome film grain over whatever is on the canvas. */
export function grain(env: Env, amount: number) {
	if (amount <= 0) return;
	const { ctx, w, h, rng } = env;
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	const k = amount * 255;
	for (let i = 0; i < d.length; i += 4) {
		const n = (rng() - 0.5) * k;
		d[i] += n;
		d[i + 1] += n;
		d[i + 2] += n;
	}
	ctx.putImageData(img, 0, 0);
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
	return c.getContext("2d", { willReadFrequently: true })!;
}

export const WORDS = [
	"MOSH",
	"SIGNAL",
	"NOISE",
	"DECAY",
	"STATIC",
	"DROPOUT",
	"GLITCH",
	"REWIND",
	"ARTIFACT",
	"NO INPUT",
	"DEAD AIR",
	"RIPPED",
];

export const HEAVY = `"Helvetica Neue", Arial, sans-serif`;
export const MONO = `"Courier New", ui-monospace, monospace`;

/** Set a font so `text` spans `width` pixels; returns the size. */
export function fitFont(
	ctx: CanvasRenderingContext2D,
	text: string,
	width: number,
	weight = 900,
	family = HEAVY,
): number {
	ctx.font = `${weight} 100px ${family}`;
	const size = (100 * width) / ctx.measureText(text).width;
	ctx.font = `${weight} ${size}px ${family}`;
	return size;
}

/** Fill a polyline as a ribbon whose half-width follows `width(t)`, t in 0..1. */
export function ribbon(
	ctx: CanvasRenderingContext2D,
	pts: number[],
	width: (t: number) => number,
) {
	const n = pts.length / 2;
	if (n < 2) return;
	const left: number[] = [];
	const right: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = Math.max(i - 1, 0);
		const b = Math.min(i + 1, n - 1);
		let dx = pts[b * 2] - pts[a * 2];
		let dy = pts[b * 2 + 1] - pts[a * 2 + 1];
		const len = Math.hypot(dx, dy) || 1;
		dx /= len;
		dy /= len;
		const hw = width(i / (n - 1));
		const x = pts[i * 2];
		const y = pts[i * 2 + 1];
		left.push(x - dy * hw, y + dx * hw);
		right.push(x + dy * hw, y - dx * hw);
	}
	ctx.beginPath();
	ctx.moveTo(left[0], left[1]);
	for (let i = 1; i < n; i++) ctx.lineTo(left[i * 2], left[i * 2 + 1]);
	for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i * 2], right[i * 2 + 1]);
	ctx.closePath();
	ctx.fill();
}

/** Disjoint-set over integer ids. */
export function unionFind(n: number) {
	const parent = new Int32Array(n);
	for (let i = 0; i < n; i++) parent[i] = i;
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	return {
		find,
		union(a: number, b: number) {
			const ra = find(a);
			const rb = find(b);
			if (ra !== rb) parent[ra] = rb;
		},
	};
}

export function hashInt(x: number): number {
	x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
	x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
	return (x ^ (x >>> 16)) >>> 0;
}
