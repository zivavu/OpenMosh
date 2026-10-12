import {
	fbm,
	grain,
	makeNoise,
	mixHex,
	ribbon,
	shuffle,
	TAU,
	withAlpha,
	type Generator,
} from "../kit";

export const flowfield: Generator = {
	id: "flowfield",
	name: "Flow-field ink",
	group: "Simulated",
	blurb:
		"Strokes traced through a smooth vector field: thin strands, ribbons that never touch, circuit traces locked to 45°, or bristly brush marks.",
	params: [
		{
			key: "style",
			label: "Style",
			type: "select",
			options: ["Ribbons", "Strands", "Circuit", "Brush"],
			value: "Ribbons",
		},
		{
			key: "count",
			label: "Stroke count",
			type: "range",
			min: 50,
			max: 5000,
			step: 10,
			value: 1500,
		},
		{
			key: "zoom",
			label: "Field scale",
			type: "range",
			min: 0.3,
			max: 6,
			value: 1.6,
		},
		{
			key: "turb",
			label: "Turbulence",
			type: "range",
			min: 0,
			max: 1,
			value: 0.3,
		},
		{
			key: "length",
			label: "Max length",
			type: "range",
			min: 10,
			max: 600,
			step: 1,
			value: 160,
		},
		{
			key: "width",
			label: "Width",
			type: "range",
			min: 0.5,
			max: 30,
			value: 5,
		},
		{ key: "dark", label: "Dark background", type: "bool", value: false },
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks, s } = env;
		const noise = makeNoise(rng);
		const zoom = (p.zoom as number) / u;
		const turb = p.turb as number;
		const base = rng() * TAU;
		const style = p.style as string;
		const quant = style === "Circuit";
		const fieldAt = (x: number, y: number) => {
			let a =
				base +
				fbm(noise, x * zoom, y * zoom, 1 + Math.round(turb * 3)) *
					TAU *
					(0.6 + turb);
			if (quant) a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
			return a;
		};
		const dark = !!p.dark;
		ctx.fillStyle = dark ? inks[0] : mixHex(inks[4], "#f4efe4", 0.6);
		ctx.fillRect(0, 0, w, h);
		const pens = shuffle(
			rng,
			dark
				? [inks[2], inks[3], inks[4], inks[3]]
				: [inks[0], inks[1], inks[2], inks[1]],
		);
		const width = (p.width as number) * s;
		const stepLen = Math.max(
			1,
			width * (style === "Strands" ? 1.2 : 0.6),
			u * 0.002,
		);
		const maxSteps = p.length as number;

		// Ribbons and Circuit keep apart: an occupancy grid stops a stroke near another.
		const sep = style === "Strands" || style === "Brush" ? 0 : width * 2.2;
		const cell = Math.max(2, sep);
		const gw = Math.ceil(w / cell);
		const gh = Math.ceil(h / cell);
		const occ = new Int32Array(gw * gh).fill(-1);
		const blocked = (x: number, y: number, id: number) => {
			if (!sep) return false;
			const gx = Math.floor(x / cell);
			const gy = Math.floor(y / cell);
			for (let j = -1; j <= 1; j++)
				for (let i = -1; i <= 1; i++) {
					const xx = gx + i;
					const yy = gy + j;
					if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
					const o = occ[yy * gw + xx];
					if (o !== -1 && o !== id) return true;
				}
			return false;
		};

		const trace = (sx: number, sy: number, dir: 1 | -1, id: number) => {
			const pts: number[] = [];
			let x = sx;
			let y = sy;
			for (let i = 0; i < maxSteps; i++) {
				if (x < -width || y < -width || x > w + width || y > h + width) break;
				if (blocked(x, y, id)) break;
				pts.push(x, y);
				const a = fieldAt(x, y);
				x += Math.cos(a) * stepLen * dir;
				y += Math.sin(a) * stepLen * dir;
			}
			return pts;
		};

		const n = p.count as number;
		const starts: [number, number][] = [];
		const side = Math.ceil(Math.sqrt(n * (w / h)));
		const gap = w / side;
		for (let y = gap / 2; y < h; y += gap)
			for (let x = gap / 2; x < w; x += gap)
				starts.push([x + (rng() - 0.5) * gap, y + (rng() - 0.5) * gap]);
		shuffle(rng, starts);

		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		let id = 0;
		for (const [sx, sy] of starts) {
			if (blocked(sx, sy, -2)) continue;
			const back = trace(sx, sy, -1, id);
			const fwd = trace(sx, sy, 1, id);
			const pts: number[] = [];
			for (let i = back.length - 2; i >= 2; i -= 2)
				pts.push(back[i], back[i + 1]);
			pts.push(...fwd);
			if (pts.length < 8) continue;
			if (sep)
				for (let i = 0; i < pts.length; i += 2) {
					const gx = Math.floor(pts[i] / cell);
					const gy = Math.floor(pts[i + 1] / cell);
					if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) occ[gy * gw + gx] = id;
				}
			id++;
			const pen =
				pens[
					Math.floor(
						(noise(sx * zoom * 0.5 + 9, sy * zoom * 0.5) * 0.5 + 0.5) *
							pens.length *
							1.5 +
							rng() * 0.8,
					) % pens.length
				];

			if (style === "Strands") {
				ctx.strokeStyle = withAlpha(pen, 0.75);
				ctx.lineWidth = width * 0.4;
				ctx.beginPath();
				ctx.moveTo(pts[0], pts[1]);
				for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
				ctx.stroke();
			} else if (style === "Brush") {
				const bristles = 6;
				for (let b = 0; b < bristles; b++) {
					const off = (b / (bristles - 1) - 0.5) * width * 1.6;
					const shifted: number[] = [];
					for (let i = 0; i < pts.length; i += 2) {
						const j = Math.min(i + 2, pts.length - 2);
						const k = Math.max(i - 2, 0);
						const dx = pts[j] - pts[k];
						const dy = pts[j + 1] - pts[k + 1];
						const l = Math.hypot(dx, dy) || 1;
						shifted.push(pts[i] - (dy / l) * off, pts[i + 1] + (dx / l) * off);
					}
					ctx.fillStyle = withAlpha(pen, 0.25 + rng() * 0.35);
					const bw = width * (0.12 + rng() * 0.2);
					const fade = 0.6 + rng() * 0.4;
					ribbon(
						ctx,
						shifted,
						(t) => bw * Math.sin(Math.PI * Math.min(1, t / fade)) + 0.2,
					);
				}
			} else {
				ctx.fillStyle = pen;
				const taper = style === "Circuit" ? 0.02 : 0.15;
				ribbon(
					ctx,
					pts,
					(t) => width * Math.min(1, Math.min(t, 1 - t) / taper + 0.15),
				);
				if (style === "Circuit") {
					for (const k of [0, pts.length - 2]) {
						ctx.beginPath();
						ctx.arc(pts[k], pts[k + 1], width * 1.4, 0, TAU);
						ctx.fill();
					}
				}
			}
		}
		grain(env, 0.035);
	},
};
