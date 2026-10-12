import {
	ctx2d,
	hexRgb,
	int,
	makeCanvas,
	pick,
	ramp,
	type Generator,
	type Rand,
} from "../kit";

type Step = (x: number, y: number, out: Float64Array) => void;

interface System {
	step: Step;
	/** Colour coordinate update per step; flames use their map's colour. */
	colorOf?: (k: number) => number;
}

function clifford(rng: Rand): System {
	const [a, b, c, d] = [0, 0, 0, 0].map(() => (rng() - 0.5) * 4);
	return {
		step(x, y, o) {
			o[0] = Math.sin(a * y) + c * Math.cos(a * x);
			o[1] = Math.sin(b * x) + d * Math.cos(b * y);
		},
	};
}

function dejong(rng: Rand): System {
	const [a, b, c, d] = [0, 0, 0, 0].map(() => (rng() - 0.5) * 6);
	return {
		step(x, y, o) {
			o[0] = Math.sin(a * y) - Math.cos(b * x);
			o[1] = Math.sin(c * x) - Math.cos(d * y);
		},
	};
}

type Variation = (x: number, y: number, o: Float64Array) => void;

const VARIATIONS: Variation[] = [
	(x, y, o) => {
		o[0] = x;
		o[1] = y;
	},
	(x, y, o) => {
		o[0] = Math.sin(x);
		o[1] = Math.sin(y);
	},
	(x, y, o) => {
		const r = 1 / (x * x + y * y + 1e-9);
		o[0] = x * r;
		o[1] = y * r;
	},
	(x, y, o) => {
		const r2 = x * x + y * y;
		const s = Math.sin(r2);
		const c = Math.cos(r2);
		o[0] = x * s - y * c;
		o[1] = x * c + y * s;
	},
	(x, y, o) => {
		const r = Math.sqrt(x * x + y * y) + 1e-9;
		o[0] = ((x - y) * (x + y)) / r;
		o[1] = (2 * x * y) / r;
	},
	(x, y, o) => {
		o[0] = Math.atan2(x, y) / Math.PI;
		o[1] = Math.sqrt(x * x + y * y) - 1;
	},
	(x, y, o) => {
		const r = Math.sqrt(x * x + y * y);
		const t = Math.atan2(x, y);
		o[0] = r * Math.sin(t * r);
		o[1] = -r * Math.cos(t * r);
	},
	(x, y, o) => {
		const r = Math.sqrt(x * x + y * y);
		const t = Math.atan2(x, y) / Math.PI;
		o[0] = t * Math.sin(Math.PI * r);
		o[1] = t * Math.cos(Math.PI * r);
	},
];

function flame(rng: Rand): System {
	const n = int(rng, 2, 5);
	const maps = Array.from({ length: n }, () => {
		const v1 = int(rng, 0, VARIATIONS.length - 1);
		const v2 = int(rng, 0, VARIATIONS.length - 1);
		return {
			a: (rng() - 0.5) * 2,
			b: (rng() - 0.5) * 2,
			c: (rng() - 0.5) * 2,
			d: (rng() - 0.5) * 2,
			e: (rng() - 0.5) * 2,
			f: (rng() - 0.5) * 2,
			v1: VARIATIONS[v1],
			v2: VARIATIONS[v2],
			mix: rng(),
			weight: 0.2 + rng(),
			color: rng(),
		};
	});
	const total = maps.reduce((s, m) => s + m.weight, 0);
	const tmp = new Float64Array(2);
	let last = 0;
	return {
		step(x, y, o) {
			let r = rng() * total;
			let k = 0;
			while (k < n - 1 && (r -= maps[k].weight) > 0) k++;
			const m = maps[k];
			last = k;
			const ax = m.a * x + m.b * y + m.c;
			const ay = m.d * x + m.e * y + m.f;
			m.v1(ax, ay, tmp);
			const x1 = tmp[0] * (1 - m.mix);
			const y1 = tmp[1] * (1 - m.mix);
			m.v2(ax, ay, tmp);
			o[0] = x1 + tmp[0] * m.mix;
			o[1] = y1 + tmp[1] * m.mix;
		},
		colorOf: () => maps[last].color,
	};
}

const MAKERS: Record<string, (rng: Rand) => System> = {
	Clifford: clifford,
	"De Jong": dejong,
	Flame: flame,
};

export const attractor: Generator = {
	id: "attractor",
	name: "Attractors & flames",
	group: "Simulated",
	blurb:
		"Millions of points from a Clifford or De Jong attractor or a fractal-flame IFS, piled into a density buffer and tone-mapped into glowing filaments.",
	params: [
		{
			key: "kind",
			label: "System",
			type: "select",
			options: ["Random", "Clifford", "De Jong", "Flame"],
			value: "Random",
		},
		{
			key: "points",
			label: "Points (millions)",
			type: "range",
			min: 0.5,
			max: 10,
			value: 3,
		},
		{
			key: "exposure",
			label: "Exposure",
			type: "range",
			min: 0.3,
			max: 4,
			value: 1.4,
		},
		{ key: "gamma", label: "Gamma", type: "range", min: 1, max: 4, value: 2.2 },
		{
			key: "symmetry",
			label: "Rotational symmetry",
			type: "range",
			min: 1,
			max: 8,
			step: 1,
			value: 1,
		},
		{ key: "glow", label: "Glow", type: "range", min: 0, max: 1, value: 0.35 },
		{ key: "light", label: "Light background", type: "bool", value: false },
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const kind =
			p.kind === "Random"
				? pick(rng, ["Clifford", "De Jong", "Flame", "Flame"])
				: (p.kind as string);
		const o = new Float64Array(2);
		const sym = p.symmetry as number;

		// Try parameter sets and keep the one whose orbit covers the most area.
		let sys: System = MAKERS[kind](rng);
		let bounds = [-2, 2, -2, 2];
		let best = -1;
		for (let attempt = 0; attempt < 60 && best < 700; attempt++) {
			const cand = MAKERS[kind](rng);
			let x = rng() - 0.5;
			let y = rng() - 0.5;
			const xs: number[] = [];
			const ys: number[] = [];
			let ok = true;
			for (let i = 0; i < 8000; i++) {
				cand.step(x, y, o);
				x = o[0];
				y = o[1];
				if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6) {
					ok = false;
					break;
				}
				if (i > 100) {
					xs.push(x);
					ys.push(y);
				}
			}
			if (!ok) continue;
			const q = (arr: number[], t: number) => {
				const sorted = [...arr].sort((a, b) => a - b);
				return [
					sorted[Math.floor(t * (arr.length - 1))],
					sorted[Math.floor((1 - t) * (arr.length - 1))],
				];
			};
			const [bx0, bx1] = q(xs, 0.01);
			const [by0, by1] = q(ys, 0.01);
			if (bx1 - bx0 < 1e-3 || by1 - by0 < 1e-3) continue;
			const occ = new Set<number>();
			for (let i = 0; i < xs.length; i++) {
				const gx = Math.floor(((xs[i] - bx0) / (bx1 - bx0)) * 48);
				const gy = Math.floor(((ys[i] - by0) / (by1 - by0)) * 48);
				if (gx >= 0 && gy >= 0 && gx < 48 && gy < 48) occ.add(gy * 48 + gx);
			}
			if (occ.size > best) {
				best = occ.size;
				sys = cand;
				bounds = [bx0, bx1, by0, by1];
			}
		}

		let [x0, x1, y0, y1] = bounds;
		if (sym > 1) {
			const r = Math.max(
				Math.abs(x0),
				Math.abs(x1),
				Math.abs(y0),
				Math.abs(y1),
			);
			[x0, x1, y0, y1] = [-r, r, -r, r];
		}
		const cx = (x0 + x1) / 2;
		const cy = (y0 + y1) / 2;
		const scale = Math.min((w * 0.86) / (x1 - x0), (h * 0.86) / (y1 - y0));

		const dens = new Float32Array(w * h);
		const hue = new Float32Array(w * h);
		const total = Math.round((p.points as number) * 1e6);
		let x = rng() - 0.5;
		let y = rng() - 0.5;
		let c = 0.5;
		let px = 0;
		let py = 0;
		const rot = Array.from({ length: sym }, (_, k) => [
			Math.cos((k * Math.PI * 2) / sym),
			Math.sin((k * Math.PI * 2) / sym),
		]);
		for (let i = 0; i < total; i++) {
			sys.step(x, y, o);
			const nx = o[0];
			const ny = o[1];
			if (!Number.isFinite(nx) || !Number.isFinite(ny) || Math.abs(nx) > 1e6) {
				x = rng() - 0.5;
				y = rng() - 0.5;
				continue;
			}
			if (sys.colorOf) c = (c + sys.colorOf(i)) * 0.5;
			else {
				const v = Math.min(1, Math.hypot(nx - x, ny - y) / 2.5);
				c = c * 0.92 + v * 0.08;
			}
			x = nx;
			y = ny;
			if (i < 50) continue;
			const [rc, rs] = rot[sym > 1 ? Math.floor(rng() * sym) : 0];
			const rx = (x - cx) * rc - (y - cy) * rs;
			const ry = (x - cx) * rs + (y - cy) * rc;
			px = Math.floor(w / 2 + rx * scale);
			py = Math.floor(h / 2 - ry * scale);
			if (px < 0 || py < 0 || px >= w || py >= h) continue;
			const k = py * w + px;
			dens[k] += 1;
			hue[k] += c;
		}

		let max = 0;
		for (let i = 0; i < dens.length; i++) if (dens[i] > max) max = dens[i];
		const logMax = Math.log1p(max);
		const col = ramp(inks);
		const light = !!p.light;
		const bg = hexRgb(light ? inks[4] : inks[0]);
		const exposure = p.exposure as number;
		const invGamma = 1 / (p.gamma as number);
		const img = ctx.createImageData(w, h);
		const d = img.data;
		for (let i = 0; i < dens.length; i++) {
			const n = dens[i];
			let r = bg[0];
			let g = bg[1];
			let b = bg[2];
			if (n > 0) {
				const a = Math.min(1, (Math.log1p(n) / logMax) ** invGamma * exposure);
				const t = hue[i] / n;
				const fg = col(light ? 0.05 + t * 0.6 : 0.35 + t * 0.65);
				r += (fg[0] - r) * a;
				g += (fg[1] - g) * a;
				b += (fg[2] - b) * a;
			}
			d[i * 4] = r;
			d[i * 4 + 1] = g;
			d[i * 4 + 2] = b;
			d[i * 4 + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);

		const glow = p.glow as number;
		if (glow > 0) {
			const copy = makeCanvas(w, h);
			const cc = ctx2d(copy);
			cc.filter = `blur(${u * 0.012}px)`;
			cc.drawImage(ctx.canvas, 0, 0);
			ctx.save();
			ctx.globalCompositeOperation = light ? "multiply" : "screen";
			ctx.globalAlpha = glow;
			ctx.drawImage(copy, 0, 0);
			ctx.restore();
		}
	},
};
