/** Seeded 2D gradient noise on the CPU, for generators that shape geometry
 * before it reaches the GPU. */

import { shuffle, type Rand } from "../rng";

export type Noise2 = (x: number, y: number) => number;

/** Roughly -1..1. Consumes a fixed amount of `rng`, so later draws stay put. */
export function makeNoise(rng: Rand): Noise2 {
	const p = shuffle(
		rng,
		Array.from({ length: 256 }, (_, i) => i),
	);
	const perm = new Uint8Array(512);
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
	const gx = new Float32Array(256);
	const gy = new Float32Array(256);
	for (let i = 0; i < 256; i++) {
		const a = rng() * Math.PI * 2;
		gx[i] = Math.cos(a);
		gy[i] = Math.sin(a);
	}
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const grad = (ix: number, iy: number, dx: number, dy: number) => {
		const k = perm[ix + perm[iy]];
		return gx[k] * dx + gy[k] * dy;
	};
	return (x, y) => {
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const xf = x - xi;
		const yf = y - yi;
		const X = xi & 255;
		const Y = yi & 255;
		const u = fade(xf);
		const v = fade(yf);
		const n00 = grad(X, Y, xf, yf);
		const n10 = grad(X + 1, Y, xf - 1, yf);
		const n01 = grad(X, Y + 1, xf, yf - 1);
		const n11 = grad(X + 1, Y + 1, xf - 1, yf - 1);
		const a = n00 + (n10 - n00) * u;
		const b = n01 + (n11 - n01) * u;
		return (a + (b - a) * v) * 1.41;
	};
}

export function fbm(noise: Noise2, x: number, y: number, octaves: number) {
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
