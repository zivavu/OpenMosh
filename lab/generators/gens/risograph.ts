import {
	ctx2d,
	fitFont,
	grain,
	HEAVY,
	makeCanvas,
	makeNoise,
	mixHex,
	pick,
	shuffle,
	WORDS,
	type Env,
	type Generator,
	type Rand,
} from "../kit";

type Paint = (ctx: CanvasRenderingContext2D, soft: boolean) => void;

const SCREEN_ANGLES = [15, 75, 45, 0];

function blobs(rng: Rand, w: number, h: number, u: number): Paint {
	const shapes = Array.from({ length: 2 + Math.floor(rng() * 3) }, () => ({
		x: rng() * w,
		y: rng() * h,
		r: u * (0.18 + rng() * 0.45),
	}));
	return (ctx, soft) => {
		for (const s of shapes) {
			if (soft) {
				const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
				g.addColorStop(0, "#fff");
				g.addColorStop(0.55, "rgba(255,255,255,0.7)");
				g.addColorStop(1, "rgba(255,255,255,0)");
				ctx.fillStyle = g;
			} else ctx.fillStyle = "#fff";
			ctx.beginPath();
			ctx.arc(s.x, s.y, soft ? s.r : s.r * 0.6, 0, Math.PI * 2);
			ctx.fill();
		}
	};
}

function bars(rng: Rand, w: number, h: number, u: number): Paint {
	const angle = (pick(rng, [0, 90, 45, -30, 15]) * Math.PI) / 180;
	const count = 2 + Math.floor(rng() * 4);
	const items = Array.from({ length: count }, () => ({
		off: (rng() - 0.5) * Math.max(w, h),
		thick: u * (0.06 + rng() * 0.3),
		flip: rng() < 0.5,
	}));
	return (ctx, soft) => {
		ctx.save();
		ctx.translate(w / 2, h / 2);
		ctx.rotate(angle);
		const L = Math.hypot(w, h);
		for (const b of items) {
			if (soft) {
				const g = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
				g.addColorStop(b.flip ? 1 : 0, "rgba(255,255,255,0.05)");
				g.addColorStop(b.flip ? 0 : 1, "#fff");
				ctx.fillStyle = g;
			} else ctx.fillStyle = "#fff";
			ctx.fillRect(-L / 2, b.off - b.thick / 2, L, b.thick);
		}
		ctx.restore();
	};
}

function type(rng: Rand, w: number, h: number): Paint {
	const word = pick(rng, WORDS);
	const tilt = (rng() - 0.5) * 0.3;
	const stacked = rng() < 0.4;
	return (ctx, soft) => {
		ctx.save();
		ctx.translate(w / 2, h / 2);
		ctx.rotate(tilt);
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const size = fitFont(ctx, word, w * 0.92, 900, HEAVY);
		if (soft) {
			const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
			g.addColorStop(0, "#fff");
			g.addColorStop(1, "rgba(255,255,255,0.25)");
			ctx.fillStyle = g;
		} else ctx.fillStyle = "#fff";
		if (stacked)
			for (let i = -2; i <= 2; i++) ctx.fillText(word, 0, i * size * 0.82);
		else ctx.fillText(word, 0, 0);
		ctx.restore();
	};
}

function wash(rng: Rand, w: number, h: number): Paint {
	const a = rng() * Math.PI * 2;
	return (ctx, soft) => {
		const dx = Math.cos(a) * w * 0.5;
		const dy = Math.sin(a) * h * 0.5;
		const g = ctx.createLinearGradient(
			w / 2 - dx,
			h / 2 - dy,
			w / 2 + dx,
			h / 2 + dy,
		);
		g.addColorStop(0, "rgba(255,255,255,0)");
		g.addColorStop(1, soft ? "rgba(255,255,255,0.8)" : "#fff");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
	};
}

export const risograph: Generator = {
	id: "risograph",
	name: "Risograph",
	group: "Graphic & print",
	blurb:
		"Two to four spot-colour layers, each a halftone screen at its own angle, printed slightly out of register onto paper.",
	params: [
		{
			key: "layers",
			label: "Ink layers",
			type: "range",
			min: 2,
			max: 4,
			step: 1,
			value: 3,
		},
		{
			key: "dot",
			label: "Dot pitch",
			type: "range",
			min: 0.004,
			max: 0.03,
			value: 0.011,
		},
		{
			key: "misreg",
			label: "Misregistration",
			type: "range",
			min: 0,
			max: 0.03,
			value: 0.007,
		},
		{
			key: "flat",
			label: "Solid-ink chance",
			type: "range",
			min: 0,
			max: 1,
			value: 0.3,
		},
		{
			key: "comp",
			label: "Composition",
			type: "select",
			options: ["Mixed", "Blobs", "Bars", "Type"],
			value: "Mixed",
		},
		{
			key: "paper",
			label: "Paper",
			type: "select",
			options: ["Cream", "White", "Tinted", "Kraft"],
			value: "Cream",
		},
		{
			key: "starve",
			label: "Ink starvation",
			type: "range",
			min: 0,
			max: 1,
			value: 0.4,
		},
	],
	render(env: Env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const paper =
			p.paper === "White"
				? "#f7f6f2"
				: p.paper === "Tinted"
					? mixHex(inks[4], "#ffffff", 0.55)
					: p.paper === "Kraft"
						? "#cdb595"
						: "#f1ebdd";
		ctx.fillStyle = paper;
		ctx.fillRect(0, 0, w, h);

		const layers = p.layers as number;
		const colors = shuffle(rng, [inks[1], inks[2], inks[3]]);
		if (layers > 3) colors.push(inks[0]);
		const noise = makeNoise(rng);
		const comps = shuffle(rng, [blobs, bars, type, wash]);
		const pitch = Math.max(2, (p.dot as number) * u);
		const ms = 0.25;
		const mw = Math.ceil(w * ms);
		const mh = Math.ceil(h * ms);
		const mask = makeCanvas(mw, mh);
		const mctx = ctx2d(mask);

		for (let li = 0; li < layers; li++) {
			const ink = colors[li % colors.length];
			let paint: Paint;
			if (p.comp === "Blobs") paint = blobs(rng, w, h, u);
			else if (p.comp === "Bars") paint = bars(rng, w, h, u);
			else if (p.comp === "Type")
				paint = li === layers - 1 ? type(rng, w, h) : blobs(rng, w, h, u);
			else {
				const make = comps[li % comps.length];
				paint = make === type ? type(rng, w, h) : make(rng, w, h, u);
			}
			const dx = (rng() - 0.5) * 2 * (p.misreg as number) * u;
			const dy = (rng() - 0.5) * 2 * (p.misreg as number) * u;
			const solid = rng() < (p.flat as number);

			ctx.save();
			ctx.globalCompositeOperation = "multiply";
			ctx.fillStyle = ink;
			if (solid) {
				const layer = makeCanvas(w, h);
				const lctx = ctx2d(layer);
				paint(lctx, false);
				lctx.globalCompositeOperation = "source-in";
				lctx.fillStyle = ink;
				lctx.fillRect(0, 0, w, h);
				lctx.globalCompositeOperation = "destination-out";
				const holes = Math.round(((w * h) / 300) * (p.starve as number));
				lctx.fillStyle = "#000";
				for (let i = 0; i < holes; i++) {
					const x = rng() * w;
					const y = rng() * h;
					const r = (0.4 + rng() * 1.6) * env.s;
					lctx.globalAlpha = 0.3 + rng() * 0.7;
					lctx.fillRect(x, y, r, r);
				}
				ctx.globalAlpha = 0.92;
				ctx.drawImage(layer, dx, dy);
			} else {
				mctx.setTransform(1, 0, 0, 1, 0, 0);
				mctx.fillStyle = "#000";
				mctx.fillRect(0, 0, mw, mh);
				mctx.setTransform(ms, 0, 0, ms, 0, 0);
				paint(mctx, true);
				const data = mctx.getImageData(0, 0, mw, mh).data;
				const a = (SCREEN_ANGLES[li % SCREEN_ANGLES.length] * Math.PI) / 180;
				const ca = Math.cos(a);
				const sa = Math.sin(a);
				const reach = Math.hypot(w, h) / 2 / pitch + 2;
				const starve = p.starve as number;
				ctx.beginPath();
				for (let j = -reach; j <= reach; j++) {
					for (let i = -reach; i <= reach; i++) {
						const x = w / 2 + (i * ca - j * sa) * pitch;
						const y = h / 2 + (i * sa + j * ca) * pitch;
						if (x < -pitch || y < -pitch || x > w + pitch || y > h + pitch)
							continue;
						const mx = Math.min(mw - 1, Math.max(0, Math.floor(x * ms)));
						const my = Math.min(mh - 1, Math.max(0, Math.floor(y * ms)));
						let d = data[(my * mw + mx) * 4] / 255;
						d *=
							1 -
							starve *
								0.35 *
								(noise(x / (u * 0.08), y / (u * 0.08)) * 0.5 + 0.5);
						const r = pitch * 0.62 * Math.sqrt(d);
						if (r < 0.35) continue;
						ctx.moveTo(x + dx + r, y + dy);
						ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
					}
				}
				ctx.fill();
			}
			ctx.restore();
		}
		grain(env, 0.05);
	},
};
