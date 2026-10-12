import { grain, shuffle, TAU, type Generator } from "../kit";

// Ink drops and tine strokes as exact area-preserving maps, after Aubrey Jaffer's
// "Mathematical Marbling" (Lu, Jaffer et al., IEEE CG&A 2012).

interface Blot {
	pts: number[];
	color: string;
}

const MAX_VERTS = 40000;

function subdivide(blots: Blot[], maxSeg: number) {
	for (const b of blots) {
		const src = b.pts;
		const n = src.length / 2;
		if (n >= MAX_VERTS) continue;
		const out: number[] = [];
		for (let i = 0; i < n; i++) {
			const x0 = src[i * 2];
			const y0 = src[i * 2 + 1];
			const j = (i + 1) % n;
			const x1 = src[j * 2];
			const y1 = src[j * 2 + 1];
			out.push(x0, y0);
			const len = Math.hypot(x1 - x0, y1 - y0);
			if (len > maxSeg) {
				const k = Math.min(Math.ceil(len / maxSeg), 64);
				for (let s = 1; s < k; s++)
					out.push(x0 + ((x1 - x0) * s) / k, y0 + ((y1 - y0) * s) / k);
			}
		}
		b.pts = out;
	}
}

function drop(
	blots: Blot[],
	cx: number,
	cy: number,
	r: number,
	color: string,
	maxSeg: number,
) {
	const r2 = r * r;
	for (const b of blots) {
		const p = b.pts;
		for (let i = 0; i < p.length; i += 2) {
			const dx = p[i] - cx;
			const dy = p[i + 1] - cy;
			const f = Math.sqrt(1 + r2 / (dx * dx + dy * dy + 1e-9));
			p[i] = cx + dx * f;
			p[i + 1] = cy + dy * f;
		}
	}
	const n = Math.max(24, Math.ceil((TAU * r) / maxSeg));
	const pts: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * TAU;
		pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
	}
	blots.push({ pts, color });
}

/** One tine dragged along direction (mx,my) through point (bx,by). */
function tine(
	blots: Blot[],
	bx: number,
	by: number,
	mx: number,
	my: number,
	z: number,
	lambda: number,
) {
	const nx = -my;
	const ny = mx;
	for (const b of blots) {
		const p = b.pts;
		for (let i = 0; i < p.length; i += 2) {
			const d = Math.abs((p[i] - bx) * nx + (p[i + 1] - by) * ny);
			const s = (z * lambda) / (d + lambda);
			p[i] += mx * s;
			p[i + 1] += my * s;
		}
	}
}

function vortex(
	blots: Blot[],
	cx: number,
	cy: number,
	turn: number,
	lambda: number,
) {
	for (const b of blots) {
		const p = b.pts;
		for (let i = 0; i < p.length; i += 2) {
			const dx = p[i] - cx;
			const dy = p[i + 1] - cy;
			const a = (turn * lambda) / (Math.hypot(dx, dy) + lambda);
			const c = Math.cos(a);
			const s = Math.sin(a);
			p[i] = cx + dx * c - dy * s;
			p[i + 1] = cy + dx * s + dy * c;
		}
	}
}

export const marbling: Generator = {
	id: "marbling",
	name: "Marbling",
	group: "Simulated",
	blurb:
		"Suminagashi and Turkish ebru done with exact maths: ink drops push earlier ink into rings, then combs and swirls drag it into feathered bands.",
	params: [
		{
			key: "pattern",
			label: "Pattern",
			type: "select",
			options: ["Combed", "Stone", "Chevron", "Swirl"],
			value: "Combed",
		},
		{
			key: "sites",
			label: "Drop sites",
			type: "range",
			min: 4,
			max: 80,
			step: 1,
			value: 24,
		},
		{
			key: "rings",
			label: "Drops per site",
			type: "range",
			min: 1,
			max: 6,
			step: 1,
			value: 3,
		},
		{
			key: "size",
			label: "Drop size",
			type: "range",
			min: 0.02,
			max: 0.2,
			value: 0.07,
		},
		{
			key: "combs",
			label: "Comb passes",
			type: "range",
			min: 0,
			max: 4,
			step: 1,
			value: 2,
		},
		{
			key: "spacing",
			label: "Tine spacing",
			type: "range",
			min: 0.03,
			max: 0.4,
			value: 0.12,
		},
		{
			key: "strength",
			label: "Drag strength",
			type: "range",
			min: 0.02,
			max: 0.6,
			value: 0.2,
		},
		{ key: "dark", label: "Dark bath", type: "bool", value: false },
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const dark = !!p.dark;
		const bath = dark ? inks[0] : inks[4];
		const colors = dark
			? [inks[1], inks[2], inks[3], inks[4]]
			: [inks[0], inks[1], inks[2], inks[3]];
		shuffle(rng, colors);
		const maxSeg = u * 0.004;
		const blots: Blot[] = [];
		const sites = p.sites as number;
		const rings = p.rings as number;
		const r = (p.size as number) * u;
		const pattern = p.pattern as string;

		const positions: [number, number][] = [];
		if (pattern === "Stone") {
			for (let i = 0; i < sites; i++) positions.push([rng() * w, rng() * h]);
		} else {
			const side = Math.max(1, Math.round(Math.sqrt((sites * w) / h)));
			const down = Math.max(1, Math.round(sites / side));
			for (let j = 0; j < down; j++)
				for (let i = 0; i < side; i++)
					positions.push([
						((i + 0.5 + (rng() - 0.5) * 0.5) / side) * w,
						((j + 0.5 + (rng() - 0.5) * 0.5) / down) * h,
					]);
			shuffle(rng, positions);
		}
		let ci = 0;
		for (let k = 0; k < rings; k++)
			for (const [x, y] of positions) {
				subdivide(blots, maxSeg);
				drop(
					blots,
					x,
					y,
					r * (pattern === "Stone" ? 0.6 + rng() * 0.8 : 1),
					colors[ci++ % colors.length],
					maxSeg,
				);
			}

		const spacing = (p.spacing as number) * u;
		const z = (p.strength as number) * u;
		const lambda = spacing * 0.35;
		const combs = p.combs as number;
		const comb = (angle: number, alternate: boolean, scale = 1) => {
			subdivide(blots, maxSeg);
			const mx = Math.cos(angle);
			const my = Math.sin(angle);
			const nx = -my;
			const ny = mx;
			const span = Math.hypot(w, h);
			const step = spacing * scale;
			const phase = rng() * step;
			for (let o = -span / 2 + phase, i = 0; o < span / 2; o += step, i++) {
				const dir = alternate && i % 2 ? -1 : 1;
				tine(
					blots,
					w / 2 + nx * o,
					h / 2 + ny * o,
					mx * dir,
					my * dir,
					z,
					lambda * scale,
				);
			}
		};

		const a0 = rng() < 0.5 ? 0 : Math.PI / 2;
		if (pattern === "Combed") {
			for (let i = 0; i < combs; i++)
				comb(a0 + (i % 2) * (Math.PI / 2), false, i < 2 ? 1 : 0.5);
		} else if (pattern === "Chevron") {
			for (let i = 0; i < Math.max(1, combs); i++)
				comb(a0 + (i % 2) * (Math.PI / 2), true, 1 / (i + 1));
		} else if (pattern === "Swirl") {
			const n = Math.max(1, combs);
			for (let i = 0; i < n; i++) {
				subdivide(blots, maxSeg);
				vortex(
					blots,
					rng() * w,
					rng() * h,
					(rng() < 0.5 ? -1 : 1) * (2 + rng() * 6),
					u * (0.1 + rng() * 0.25),
				);
			}
		} else if (combs > 0) {
			comb(rng() * Math.PI, false, 3);
		}

		ctx.fillStyle = bath;
		ctx.fillRect(0, 0, w, h);
		for (const b of blots) {
			const pts = b.pts;
			ctx.fillStyle = b.color;
			ctx.beginPath();
			ctx.moveTo(pts[0], pts[1]);
			for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
			ctx.closePath();
			ctx.fill();
		}
		grain(env, 0.03);
	},
};
