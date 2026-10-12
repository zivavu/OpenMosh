import { hexRgb, int, mixRgb, type Generator } from "../kit";

/** J_n(x) by Bessel's integral, tabulated over 0..xMax. */
function besselTable(n: number, xMax: number, size = 2048): Float32Array {
	const t = new Float32Array(size);
	const steps = 96;
	for (let i = 0; i < size; i++) {
		const x = (i / (size - 1)) * xMax;
		let s = 0;
		for (let k = 0; k < steps; k++) {
			const tau = ((k + 0.5) / steps) * Math.PI;
			s += Math.cos(n * tau - x * Math.sin(tau));
		}
		t[i] = s / steps;
	}
	return t;
}

export const chladni: Generator = {
	id: "chladni",
	name: "Chladni sand",
	group: "Simulated",
	blurb:
		"Sand on a vibrating plate, settled along the nodal lines of a standing wave: a square plate's mode pairs or a round plate's Bessel modes.",
	params: [
		{
			key: "plate",
			label: "Plate",
			type: "select",
			options: ["Square", "Round"],
			value: "Square",
		},
		{
			key: "n",
			label: "Mode n (0 = from seed)",
			type: "range",
			min: 0,
			max: 14,
			step: 1,
			value: 0,
		},
		{
			key: "m",
			label: "Mode m (0 = from seed)",
			type: "range",
			min: 0,
			max: 14,
			step: 1,
			value: 0,
		},
		{
			key: "blend",
			label: "Second mode",
			type: "range",
			min: 0,
			max: 1,
			value: 0.25,
		},
		{
			key: "grains",
			label: "Grains (thousands)",
			type: "range",
			min: 50,
			max: 1500,
			step: 10,
			value: 500,
		},
		{
			key: "sharp",
			label: "Settling",
			type: "range",
			min: 0.01,
			max: 0.25,
			value: 0.06,
		},
		{
			key: "size",
			label: "Grain size",
			type: "range",
			min: 0.5,
			max: 3,
			value: 1.2,
		},
		{
			key: "finish",
			label: "Plate finish",
			type: "select",
			options: ["Steel", "Black", "Paper"],
			value: "Steel",
		},
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks, s } = env;
		const n = (p.n as number) || int(rng, 1, 9);
		let m = (p.m as number) || int(rng, 1, 9);
		if (m === n && p.plate === "Square") m = n + 1;
		const n2 = int(rng, 1, 11);
		const m2 = int(rng, 1, 11);
		const blend = p.blend as number;
		const sign = rng() < 0.5 ? -1 : 1;
		const phase = rng() * Math.PI;
		const round = p.plate === "Round";
		const R = u * 0.46;
		const cx = w / 2;
		const cy = h / 2;

		const jn = (n: number, m: number) => (m + n / 2 - 0.25) * Math.PI;
		const k1 = jn(n, m);
		const k2 = jn(n2 % 7, Math.max(1, m2 % 7));
		const J1 = round ? besselTable(n, k1) : null;
		const J2 = round ? besselTable(n2 % 7, k2) : null;
		const look = (t: Float32Array, r: number) =>
			t[Math.min(t.length - 1, Math.floor(r * (t.length - 1)))];

		const field = (x: number, y: number) => {
			if (round) {
				const dx = (x - cx) / R;
				const dy = (y - cy) / R;
				const r = Math.hypot(dx, dy);
				if (r > 1) return NaN;
				const a = Math.atan2(dy, dx);
				return (
					look(J1!, r) * Math.cos(n * a + phase) +
					blend * look(J2!, r) * Math.cos((n2 % 7) * a)
				);
			}
			const X = (x / w) * Math.PI;
			const Y = (y / h) * Math.PI;
			return (
				Math.cos(n * X) * Math.cos(m * Y) +
				sign * Math.cos(m * X) * Math.cos(n * Y) +
				blend *
					(Math.cos(n2 * X) * Math.cos(m2 * Y) -
						Math.cos(m2 * X) * Math.cos(n2 * Y))
			);
		};

		// |f| on a half-res grid, normalised, for fast rejection sampling.
		const gw = Math.ceil(w / 2);
		const gh = Math.ceil(h / 2);
		const F = new Float32Array(gw * gh);
		let fmax = 0;
		for (let y = 0; y < gh; y++)
			for (let x = 0; x < gw; x++) {
				const v = Math.abs(field(x * 2 + 1, y * 2 + 1));
				F[y * gw + x] = v;
				if (v > fmax) fmax = v;
			}
		const sigma = (p.sharp as number) * fmax;

		const A = new Float32Array(w * h);
		const T = new Float32Array(w * h);
		const rad = (p.size as number) * s;
		const target = (p.grains as number) * 1000;
		const splat = (x: number, y: number, tone: number) => {
			if (rad <= 1) {
				const x0 = Math.floor(x);
				const y0 = Math.floor(y);
				const fx = x - x0;
				const fy = y - y0;
				const put = (xx: number, yy: number, wt: number) => {
					if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
					const k = yy * w + xx;
					A[k] += wt;
					T[k] += wt * tone;
				};
				put(x0, y0, (1 - fx) * (1 - fy));
				put(x0 + 1, y0, fx * (1 - fy));
				put(x0, y0 + 1, (1 - fx) * fy);
				put(x0 + 1, y0 + 1, fx * fy);
				return;
			}
			const r = Math.ceil(rad);
			for (let j = -r; j <= r; j++)
				for (let i = -r; i <= r; i++) {
					const xx = Math.floor(x) + i;
					const yy = Math.floor(y) + j;
					if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
					const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
					const wt = Math.max(0, Math.min(1, rad - d + 0.5));
					if (!wt) continue;
					const k = yy * w + xx;
					A[k] += wt;
					T[k] += wt * tone;
				}
		};

		let placed = 0;
		for (let tries = 0; placed < target && tries < target * 250; tries++) {
			const x = rng() * w;
			const y = rng() * h;
			const v = F[Math.min(gh - 1, y >> 1) * gw + Math.min(gw - 1, x >> 1)];
			if (Number.isNaN(v)) continue;
			const stray = rng() < 0.03;
			if (!stray && rng() > Math.exp(-((v / sigma) ** 2))) continue;
			splat(x, y, rng());
			placed++;
		}

		const finish = p.finish as string;
		const paper = finish === "Paper";
		ctx.fillStyle = paper ? inks[4] : inks[0];
		ctx.fillRect(0, 0, w, h);
		if (finish === "Steel") {
			const g = ctx.createRadialGradient(
				cx * 0.8,
				cy * 0.7,
				0,
				cx,
				cy,
				Math.hypot(w, h) * 0.6,
			);
			g.addColorStop(0, inks[2]);
			g.addColorStop(0.5, inks[1]);
			g.addColorStop(1, inks[0]);
			ctx.fillStyle = g;
			if (round) {
				ctx.beginPath();
				ctx.arc(cx, cy, R, 0, Math.PI * 2);
				ctx.fill();
			} else ctx.fillRect(0, 0, w, h);
		}
		if (round) {
			ctx.strokeStyle = paper ? inks[2] : inks[3];
			ctx.lineWidth = u * 0.004;
			ctx.beginPath();
			ctx.arc(cx, cy, R, 0, Math.PI * 2);
			ctx.stroke();
		}
		const img = ctx.getImageData(0, 0, w, h);
		const d = img.data;
		const sandA = hexRgb(paper ? inks[0] : inks[3]);
		const sandB = hexRgb(paper ? inks[1] : inks[4]);
		const sh = Math.max(1, Math.round(rad * 1.3));
		for (let y = 0; y < h; y++) {
			const brushed =
				finish === "Steel"
					? Math.sin(y * 0.9 + Math.sin(y * 0.031) * 7) * 4
					: 0;
			for (let x = 0; x < w; x++) {
				const k = y * w + x;
				const i = k * 4;
				let r = d[i] + brushed;
				let g = d[i + 1] + brushed;
				let b = d[i + 2] + brushed;
				const sx = x - sh;
				const sy = y - sh;
				if (sx >= 0 && sy >= 0) {
					const shade = 1 - 0.45 * Math.min(1, A[sy * w + sx]);
					r *= shade;
					g *= shade;
					b *= shade;
				}
				const a = Math.min(1, A[k]);
				if (a > 0) {
					const c = mixRgb(sandA, sandB, T[k] / A[k]);
					r += (c[0] - r) * a;
					g += (c[1] - g) * a;
					b += (c[2] - b) * a;
				}
				d[i] = r;
				d[i + 1] = g;
				d[i + 2] = b;
			}
		}
		ctx.putImageData(img, 0, 0);
	},
};
