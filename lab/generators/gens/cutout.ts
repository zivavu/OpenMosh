import { css, grain, makeNoise, ramp, TAU, type Generator } from "../kit";

export const cutout: Generator = {
	id: "cutout",
	name: "Paper cutout",
	group: "Graphic & print",
	blurb:
		"Stacked layers of cut paper, each casting a soft shadow on the one behind: hills, a tunnel, islands or arches.",
	params: [
		{
			key: "scene",
			label: "Scene",
			type: "select",
			options: ["Hills", "Tunnel", "Islands", "Arches"],
			value: "Hills",
		},
		{
			key: "layers",
			label: "Layers",
			type: "range",
			min: 3,
			max: 14,
			step: 1,
			value: 7,
		},
		{
			key: "shadow",
			label: "Shadow",
			type: "range",
			min: 0,
			max: 1,
			value: 0.6,
		},
		{
			key: "wobble",
			label: "Wobble",
			type: "range",
			min: 0,
			max: 1,
			value: 0.5,
		},
		{
			key: "lightFront",
			label: "Light layers in front",
			type: "bool",
			value: true,
		},
		{
			key: "grain",
			label: "Paper grain",
			type: "range",
			min: 0,
			max: 0.12,
			value: 0.04,
		},
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const L = p.layers as number;
		const wob = p.wobble as number;
		const noise = makeNoise(rng);
		const col = ramp(inks);
		const tone = (i: number) =>
			css(col(p.lightFront ? i / (L - 1) : 1 - i / (L - 1)));
		const sh = p.shadow as number;
		const pad = u * 0.1;

		const shadowed = (draw: () => void, i: number) => {
			ctx.save();
			ctx.shadowColor = `rgba(0,0,0,${0.55 * sh})`;
			ctx.shadowBlur = u * 0.035 * sh;
			ctx.shadowOffsetX = u * 0.004 * sh;
			ctx.shadowOffsetY = u * 0.008 * sh;
			ctx.fillStyle = tone(i);
			draw();
			ctx.restore();
		};

		ctx.fillStyle = tone(0);
		ctx.fillRect(0, 0, w, h);

		if (p.scene === "Hills") {
			if (rng() < 0.7) {
				const r = u * (0.08 + rng() * 0.12);
				const sx = w * (0.2 + rng() * 0.6);
				const sy = h * (0.15 + rng() * 0.25);
				shadowed(
					() => {
						ctx.beginPath();
						ctx.arc(sx, sy, r, 0, TAU);
						ctx.fill();
					},
					Math.min(L - 1, Math.round(L * 0.7)),
				);
			}
			for (let i = 1; i < L; i++) {
				const base = h * (0.22 + (0.7 * i) / L);
				const amp = u * (0.04 + 0.18 * wob) * (1 - i / (L * 1.6));
				const freq = (1.2 + i * 0.25) / u;
				shadowed(() => {
					ctx.beginPath();
					ctx.moveTo(-pad, h + pad);
					for (let x = -pad; x <= w + pad; x += 4 * env.s + 1) {
						const y =
							base +
							amp *
								(noise(x * freq, i * 3.1) +
									0.35 * noise(x * freq * 3, i * 5.7));
						ctx.lineTo(x, y);
					}
					ctx.lineTo(w + pad, h + pad);
					ctx.closePath();
					ctx.fill();
				}, i);
			}
		} else if (p.scene === "Tunnel") {
			const cx0 = w * (0.35 + rng() * 0.3);
			const cy0 = h * (0.35 + rng() * 0.3);
			const driftX = (rng() - 0.5) * u * 0.25;
			const driftY = (rng() - 0.5) * u * 0.25;
			for (let i = 1; i < L; i++) {
				const t = i / (L - 1);
				const r = u * (0.08 + t * 0.55);
				const cx = cx0 + driftX * (1 - t);
				const cy = cy0 + driftY * (1 - t);
				shadowed(() => {
					ctx.beginPath();
					ctx.rect(-pad, -pad, w + pad * 2, h + pad * 2);
					const steps = 160;
					for (let k = 0; k <= steps; k++) {
						const a = (k / steps) * TAU;
						const n = noise(
							Math.cos(a) * 1.3 + i * 4.1,
							Math.sin(a) * 1.3 + i * 2.3,
						);
						const rr = r * (1 + wob * 0.35 * n);
						const x = cx + Math.cos(a) * rr;
						const y = cy + Math.sin(a) * rr;
						if (k) ctx.lineTo(x, y);
						else ctx.moveTo(x, y);
					}
					ctx.closePath();
					ctx.fill("evenodd");
				}, i);
			}
		} else if (p.scene === "Islands") {
			const centres = Array.from({ length: 2 + Math.floor(rng() * 4) }, () => ({
				x: rng() * w,
				y: rng() * h,
				r: u * (0.25 + rng() * 0.45),
				k: rng() * 100,
			}));
			for (let i = 1; i < L; i++) {
				const t = 1 - (i - 1) / (L - 1);
				shadowed(() => {
					ctx.beginPath();
					for (const c of centres) {
						const steps = 140;
						for (let k = 0; k <= steps; k++) {
							const a = (k / steps) * TAU;
							const n =
								noise(Math.cos(a) * 1.6 + c.k, Math.sin(a) * 1.6 + i * 0.35) +
								0.4 * noise(Math.cos(a) * 4 + c.k, Math.sin(a) * 4 + i * 0.5);
							const rr = c.r * t * (1 + wob * 0.45 * n);
							const x = c.x + Math.cos(a) * rr;
							const y = c.y + Math.sin(a) * rr;
							if (k) ctx.lineTo(x, y);
							else ctx.moveTo(x, y);
						}
						ctx.closePath();
					}
					ctx.fill("nonzero");
				}, i);
			}
		} else {
			const cx = w * (0.3 + rng() * 0.4);
			const cy = h + u * 0.05;
			const maxR = Math.hypot(Math.max(cx, w - cx), h) * 1.05;
			for (let i = 1; i < L; i++) {
				const r = maxR * (1 - (i - 1) / L);
				shadowed(() => {
					ctx.beginPath();
					const steps = 180;
					for (let k = 0; k <= steps; k++) {
						const a = Math.PI + (k / steps) * Math.PI;
						const n = noise(k * 0.05 + i * 9.1, i * 1.7);
						const rr = r * (1 + wob * 0.05 * n);
						const x = cx + Math.cos(a) * rr;
						const y = cy + Math.sin(a) * rr;
						if (k) ctx.lineTo(x, y);
						else ctx.moveTo(x, y);
					}
					ctx.closePath();
					ctx.fill();
				}, i);
			}
		}
		grain(env, p.grain as number);
	},
};
