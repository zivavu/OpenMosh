/** The attractor systems, on the CPU for the coefficient search and in GLSL
 * for the render. Keep the two sides in step. */

import type { Rand } from "../../rng";
import type { AttractorSystem } from "./spec";

export interface FlameMap {
	/** Affine a..f: x' = a·x + b·y + c, y' = d·x + e·y + f. */
	aff: number[];
	v1: number;
	v2: number;
	mix: number;
	weight: number;
	color: number;
}

export interface System {
	kind: 0 | 1 | 2;
	coef: number[];
	maps: FlameMap[];
	step(x: number, y: number, o: Float64Array, rng: Rand): void;
}

const VARIATIONS = 8;

function variation(k: number, x: number, y: number, o: Float64Array) {
	const r2 = x * x + y * y;
	const r = Math.sqrt(r2);
	switch (k) {
		case 0:
			o[0] = x;
			o[1] = y;
			return;
		case 1:
			o[0] = Math.sin(x);
			o[1] = Math.sin(y);
			return;
		case 2:
			o[0] = x / (r2 + 1e-9);
			o[1] = y / (r2 + 1e-9);
			return;
		case 3: {
			const s = Math.sin(r2);
			const c = Math.cos(r2);
			o[0] = x * s - y * c;
			o[1] = x * c + y * s;
			return;
		}
		case 4:
			o[0] = ((x - y) * (x + y)) / (r + 1e-9);
			o[1] = (2 * x * y) / (r + 1e-9);
			return;
		case 5:
			o[0] = Math.atan2(x, y) / Math.PI;
			o[1] = r - 1;
			return;
		case 6: {
			const t = Math.atan2(x, y);
			o[0] = r * Math.sin(t * r);
			o[1] = -r * Math.cos(t * r);
			return;
		}
		default: {
			const t = Math.atan2(x, y) / Math.PI;
			o[0] = t * Math.sin(Math.PI * r);
			o[1] = t * Math.cos(Math.PI * r);
		}
	}
}

export const SYSTEMS_GLSL = `
vec2 variation(int k, vec2 p){
  float r2=dot(p,p), r=sqrt(r2);
  if(k==0) return p;
  if(k==1) return sin(p);
  if(k==2) return p/(r2+1e-9);
  if(k==3){ float s=sin(r2), c=cos(r2); return vec2(p.x*s-p.y*c, p.x*c+p.y*s); }
  if(k==4) return vec2((p.x-p.y)*(p.x+p.y), 2.0*p.x*p.y)/(r+1e-9);
  if(k==5) return vec2(atan(p.x,p.y)/PI, r-1.0);
  if(k==6){ float t=atan(p.x,p.y); return vec2(r*sin(t*r), -r*cos(t*r)); }
  float t=atan(p.x,p.y)/PI; return vec2(t*sin(PI*r), t*cos(PI*r));
}`;

function clifford(rng: Rand): System {
	const [a, b, c, d] = [0, 0, 0, 0].map(() => (rng() - 0.5) * 4);
	return {
		kind: 0,
		coef: [a, b, c, d],
		maps: [],
		step(x, y, o) {
			o[0] = Math.sin(a * y) + c * Math.cos(a * x);
			o[1] = Math.sin(b * x) + d * Math.cos(b * y);
		},
	};
}

function dejong(rng: Rand): System {
	const [a, b, c, d] = [0, 0, 0, 0].map(() => (rng() - 0.5) * 6);
	return {
		kind: 1,
		coef: [a, b, c, d],
		maps: [],
		step(x, y, o) {
			o[0] = Math.sin(a * y) - Math.cos(b * x);
			o[1] = Math.sin(c * x) - Math.cos(d * y);
		},
	};
}

function flame(rng: Rand): System {
	const maps: FlameMap[] = Array.from(
		{ length: 2 + Math.floor(rng() * 4) },
		() => ({
			aff: [0, 0, 0, 0, 0, 0].map(() => (rng() - 0.5) * 2),
			v1: Math.floor(rng() * VARIATIONS),
			v2: Math.floor(rng() * VARIATIONS),
			mix: rng(),
			weight: 0.2 + rng(),
			color: rng(),
		}),
	);
	const total = maps.reduce((s, m) => s + m.weight, 0);
	const tmp = new Float64Array(2);
	return {
		kind: 2,
		coef: [0, 0, 0, 0],
		maps,
		step(x, y, o, r) {
			let left = r() * total;
			let k = 0;
			while (k < maps.length - 1 && (left -= maps[k].weight) > 0) k++;
			const m = maps[k];
			const ax = m.aff[0] * x + m.aff[1] * y + m.aff[2];
			const ay = m.aff[3] * x + m.aff[4] * y + m.aff[5];
			variation(m.v1, ax, ay, tmp);
			const x1 = tmp[0] * (1 - m.mix);
			const y1 = tmp[1] * (1 - m.mix);
			variation(m.v2, ax, ay, tmp);
			o[0] = x1 + tmp[0] * m.mix;
			o[1] = y1 + tmp[1] * m.mix;
		},
	};
}

const MAKERS: Record<AttractorSystem, (rng: Rand) => System> = {
	clifford,
	dejong,
	flame,
};

const SAMPLES = 4000;
const GRID = 48;

/**
 * Try up to 60 coefficient sets on a short orbit and keep the one covering the
 * most of a 48×48 grid; most random sets collapse to a point or a loop.
 * Returns it with the orbit's 1st–99th percentile bounds.
 */
export function searchSystem(
	rng: Rand,
	kind: AttractorSystem,
): { system: System; bounds: [number, number, number, number] } {
	const o = new Float64Array(2);
	const xs = new Float64Array(SAMPLES);
	const ys = new Float64Array(SAMPLES);
	let system = MAKERS[kind](rng);
	let bounds: [number, number, number, number] = [-2, 2, -2, 2];
	let best = -1;
	for (let attempt = 0; attempt < 60 && best < 700; attempt++) {
		const cand = MAKERS[kind](rng);
		let x = rng() - 0.5;
		let y = rng() - 0.5;
		let ok = true;
		for (let i = 0; i < SAMPLES + 100; i++) {
			cand.step(x, y, o, rng);
			x = o[0];
			y = o[1];
			if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6) {
				ok = false;
				break;
			}
			if (i >= 100) {
				xs[i - 100] = x;
				ys[i - 100] = y;
			}
		}
		if (!ok) continue;
		const sx = xs.slice().sort();
		const sy = ys.slice().sort();
		const lo = Math.floor(SAMPLES * 0.01);
		const hi = SAMPLES - 1 - lo;
		const [x0, x1, y0, y1] = [sx[lo], sx[hi], sy[lo], sy[hi]];
		if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) continue;
		const occ = new Uint8Array(GRID * GRID);
		let count = 0;
		for (let i = 0; i < SAMPLES; i++) {
			const gx = Math.floor(((xs[i] - x0) / (x1 - x0)) * GRID);
			const gy = Math.floor(((ys[i] - y0) / (y1 - y0)) * GRID);
			if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
			if (occ[gy * GRID + gx]) continue;
			occ[gy * GRID + gx] = 1;
			count++;
		}
		if (count > best) {
			best = count;
			system = cand;
			bounds = [x0, x1, y0, y1];
		}
	}
	return { system, bounds };
}
