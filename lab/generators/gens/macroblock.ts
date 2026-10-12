import {
	ctx2d,
	fitFont,
	HEAVY,
	int,
	makeCanvas,
	makeNoise,
	pick,
	WORDS,
	type Env,
	type Generator,
	type Rand,
} from "../kit";

// JPEG's standard quantisation tables (ITU T.81, Annex K).
const QY = [
	16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
	24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
	103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
	72, 92, 95, 98, 112, 100, 103, 99,
];
const QC = Array.from({ length: 64 }, (_, k) => {
	const u = k % 8;
	const v = Math.floor(k / 8);
	const top = [17, 18, 24, 47, 18, 21, 26, 66, 24, 26, 56, 99, 47, 66, 99, 99];
	return u < 4 && v < 4 ? top[v * 4 + u] : 99;
});

const COS = new Float32Array(64);
for (let x = 0; x < 8; x++)
	for (let u = 0; u < 8; u++)
		COS[x * 8 + u] =
			Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
			(u === 0 ? Math.SQRT1_2 : 1) *
			0.5;

/** A plane of 8×8 blocks, held as DCT coefficients block by block. */
class Plane {
	readonly bw: number;
	readonly bh: number;
	readonly coef: Float32Array;
	constructor(
		readonly w: number,
		readonly h: number,
	) {
		this.bw = w / 8;
		this.bh = h / 8;
		this.coef = new Float32Array(w * h);
	}
	at(bx: number, by: number): number {
		return (by * this.bw + bx) * 64;
	}
	forward(px: Float32Array) {
		const tmp = new Float32Array(64);
		for (let by = 0; by < this.bh; by++)
			for (let bx = 0; bx < this.bw; bx++) {
				const o = this.at(bx, by);
				for (let y = 0; y < 8; y++)
					for (let u = 0; u < 8; u++) {
						let s = 0;
						for (let x = 0; x < 8; x++)
							s +=
								(px[(by * 8 + y) * this.w + bx * 8 + x] - 128) * COS[x * 8 + u];
						tmp[y * 8 + u] = s;
					}
				for (let u = 0; u < 8; u++)
					for (let v = 0; v < 8; v++) {
						let s = 0;
						for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y * 8 + v];
						this.coef[o + v * 8 + u] = s;
					}
			}
	}
	inverse(): Float32Array {
		const px = new Float32Array(this.w * this.h);
		const tmp = new Float32Array(64);
		for (let by = 0; by < this.bh; by++)
			for (let bx = 0; bx < this.bw; bx++) {
				const o = this.at(bx, by);
				for (let y = 0; y < 8; y++)
					for (let u = 0; u < 8; u++) {
						let s = 0;
						for (let v = 0; v < 8; v++)
							s += this.coef[o + v * 8 + u] * COS[y * 8 + v];
						tmp[y * 8 + u] = s;
					}
				for (let y = 0; y < 8; y++)
					for (let x = 0; x < 8; x++) {
						let s = 0;
						for (let u = 0; u < 8; u++) s += tmp[y * 8 + u] * COS[x * 8 + u];
						px[(by * 8 + y) * this.w + bx * 8 + x] = s + 128;
					}
			}
		return px;
	}
	quantise(table: number[], scale: number) {
		for (let i = 0; i < this.coef.length; i++) {
			const q = Math.max(1, table[i & 63] * scale);
			this.coef[i] = Math.round(this.coef[i] / q) * q;
		}
	}
	copy(fx: number, fy: number, tx: number, ty: number, dcOnly = false) {
		const a = this.at(fx, fy);
		const b = this.at(tx, ty);
		if (dcOnly) {
			this.coef[b] = this.coef[a];
			this.coef.fill(0, b + 1, b + 64);
		} else this.coef.copyWithin(b, a, a + 64);
	}
}

function drawSource(
	c: CanvasRenderingContext2D,
	W: number,
	H: number,
	env: Env,
	kind: string,
) {
	const { rng, inks } = env;
	const U = Math.min(W, H);
	if (kind === "Sky") {
		const g = c.createLinearGradient(0, 0, 0, H);
		inks.forEach((ink, i) => g.addColorStop(i / 4, ink));
		c.fillStyle = g;
		c.fillRect(0, 0, W, H);
		c.fillStyle = inks[4];
		c.beginPath();
		c.arc(
			W * (0.2 + rng() * 0.6),
			H * 0.55,
			U * (0.12 + rng() * 0.12),
			0,
			Math.PI * 2,
		);
		c.fill();
		const noise = makeNoise(rng);
		for (let layer = 0; layer < 3; layer++) {
			c.fillStyle = inks[Math.max(0, 2 - layer)];
			c.beginPath();
			c.moveTo(0, H);
			for (let x = 0; x <= W; x += 2)
				c.lineTo(
					x,
					H * (0.62 + layer * 0.12) +
						noise(x / (U * 0.35), layer * 3) * U * 0.1,
				);
			c.lineTo(W, H);
			c.fill();
		}
		return;
	}
	const g = c.createLinearGradient(0, 0, W, H);
	g.addColorStop(0, inks[int(rng, 0, 2)]);
	g.addColorStop(1, inks[int(rng, 1, 4)]);
	c.fillStyle = g;
	c.fillRect(0, 0, W, H);
	if (kind === "Type") {
		c.fillStyle = inks[4];
		c.textAlign = "center";
		c.textBaseline = "middle";
		const word = pick(rng, WORDS);
		fitFont(c, word, W * 0.9, 900, HEAVY);
		c.fillText(word, W / 2, H / 2);
		return;
	}
	const n = int(rng, 4, 8);
	for (let i = 0; i < n; i++) {
		c.fillStyle = inks[int(rng, 0, 4)];
		c.save();
		c.translate(rng() * W, rng() * H);
		c.rotate(rng() * Math.PI);
		const s = U * (0.1 + rng() * 0.45);
		if (rng() < 0.5) {
			c.beginPath();
			c.arc(0, 0, s / 2, 0, Math.PI * 2);
			c.fill();
		} else c.fillRect(-s / 2, -s / 4, s, s / 2);
		c.restore();
	}
}

function corrupt(
	rng: Rand,
	Y: Plane,
	Cb: Plane,
	Cr: Plane,
	p: Record<string, unknown>,
) {
	const mw = Cb.bw;
	const mh = Cb.bh;
	const damage = p.damage as number;
	const smear = p.smear as number;
	const chroma = p.chroma as number;
	const copyMB = (
		fx: number,
		fy: number,
		tx: number,
		ty: number,
		dcOnly = false,
	) => {
		for (let j = 0; j < 2; j++)
			for (let i = 0; i < 2; i++)
				Y.copy(fx * 2 + i, fy * 2 + j, tx * 2 + i, ty * 2 + j, dcOnly);
		Cb.copy(fx, fy, tx, ty, dcOnly);
		Cr.copy(fx, fy, tx, ty, dcOnly);
	};
	const yBlocks = (mx: number, my: number) =>
		[0, 1, 2, 3].map((k) => Y.at(mx * 2 + (k & 1), my * 2 + (k >> 1)));

	for (let my = 0; my < mh; my++)
		for (let mx = 0; mx < mw; mx++) {
			const r = rng();
			if (r < damage * 0.1)
				copyMB(int(rng, 0, mw - 1), int(rng, 0, mh - 1), mx, my);
			else if (r < damage * 0.17) {
				const off = (rng() < 0.5 ? -1 : 1) * (200 + rng() * 500);
				for (const o of yBlocks(mx, my)) Y.coef[o] += off;
			} else if (r < damage * 0.23) {
				for (const o of yBlocks(mx, my))
					for (let k = 0; k < 3; k++)
						Y.coef[o + int(rng, 1, 63)] = (rng() - 0.5) * 1600;
			} else if (r < damage * 0.27) {
				for (const o of yBlocks(mx, my)) {
					Y.coef[o] = -300 - rng() * 200;
					Y.coef.fill(0, o + 1, o + 64);
				}
				Cb.coef[Cb.at(mx, my)] = -1024;
				Cr.coef[Cr.at(mx, my)] = -1024;
			}
		}

	const rects = Math.round(chroma * 7);
	for (let i = 0; i < rects; i++) {
		const x0 = int(rng, 0, mw - 1);
		const y0 = int(rng, 0, mh - 1);
		const x1 = Math.min(mw - 1, x0 + int(rng, 2, Math.max(2, mw >> 1)));
		const y1 = Math.min(mh - 1, y0 + int(rng, 1, Math.max(1, mh >> 2)));
		const dx = int(rng, -4, 4);
		const dy = int(rng, -2, 2);
		for (let my = y0; my <= y1; my++)
			for (let mx = x0; mx <= x1; mx++) {
				const fx = Math.min(mw - 1, Math.max(0, mx + dx));
				const fy = Math.min(mh - 1, Math.max(0, my + dy));
				Cb.copy(fx, fy, mx, my);
				Cr.copy(fx, fy, mx, my);
			}
	}

	for (let my = 1; my < mh; my++) {
		if (rng() < smear * 0.2) {
			const c0 = int(rng, 1, mw - 1);
			for (let mx = c0; mx < mw; mx++) copyMB(c0 - 1, my, mx, my, true);
		}
	}
	if (rng() < smear) {
		const r0 = int(rng, 1, mh - 2);
		const c0 = int(rng, 0, mw - 2);
		const c1 = Math.min(mw - 1, c0 + int(rng, 2, mw));
		for (let my = r0; my < mh; my++)
			for (let mx = c0; mx <= c1; mx++) copyMB(mx, r0 - 1, mx, my, rng() < 0.3);
	}
}

export const macroblock: Generator = {
	id: "macroblock",
	name: "Macroblocks",
	group: "Signal & broadcast",
	blurb:
		"A real 8×8 DCT codec pass over a hidden picture, then broken on purpose: lost blocks, wrong motion vectors, chroma from the wrong place, rows that smear out.",
	params: [
		{
			key: "blocks",
			label: "Blocks on short side",
			type: "range",
			min: 6,
			max: 60,
			step: 1,
			value: 18,
		},
		{
			key: "quality",
			label: "Quality",
			type: "range",
			min: 1,
			max: 80,
			step: 1,
			value: 12,
		},
		{
			key: "damage",
			label: "Block damage",
			type: "range",
			min: 0,
			max: 1,
			value: 0.4,
		},
		{
			key: "smear",
			label: "Smear",
			type: "range",
			min: 0,
			max: 1,
			value: 0.45,
		},
		{
			key: "chroma",
			label: "Chroma misplacement",
			type: "range",
			min: 0,
			max: 1,
			value: 0.4,
		},
		{
			key: "source",
			label: "Hidden picture",
			type: "select",
			options: ["Shapes", "Sky", "Type"],
			value: "Shapes",
		},
		{
			key: "pixelated",
			label: "Nearest-neighbour scale",
			type: "bool",
			value: true,
		},
	],
	render(env, p) {
		const { ctx, w, h, u, rng } = env;
		const b = p.blocks as number;
		const mbW = Math.max(2, Math.round((b * w) / u / 2));
		const mbH = Math.max(2, Math.round((b * h) / u / 2));
		const W = mbW * 16;
		const H = mbH * 16;
		const src = makeCanvas(W, H);
		const sctx = ctx2d(src);
		drawSource(sctx, W, H, env, p.source as string);
		const rgb = sctx.getImageData(0, 0, W, H);
		const d = rgb.data;

		const yPx = new Float32Array(W * H);
		const cbPx = new Float32Array((W * H) / 4);
		const crPx = new Float32Array((W * H) / 4);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				const R = d[i];
				const G = d[i + 1];
				const B = d[i + 2];
				yPx[y * W + x] = 0.299 * R + 0.587 * G + 0.114 * B;
				const c = (y >> 1) * (W / 2) + (x >> 1);
				cbPx[c] += (128 - 0.168736 * R - 0.331264 * G + 0.5 * B) / 4;
				crPx[c] += (128 + 0.5 * R - 0.418688 * G - 0.081312 * B) / 4;
			}

		const q = p.quality as number;
		const scale = (q < 50 ? 5000 / q : 200 - q * 2) / 100;
		const Y = new Plane(W, H);
		const Cb = new Plane(W / 2, H / 2);
		const Cr = new Plane(W / 2, H / 2);
		Y.forward(yPx);
		Cb.forward(cbPx);
		Cr.forward(crPx);
		Y.quantise(QY, scale);
		Cb.quantise(QC, scale);
		Cr.quantise(QC, scale);
		corrupt(rng, Y, Cb, Cr, p);

		const yo = Y.inverse();
		const cbo = Cb.inverse();
		const cro = Cr.inverse();
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				const c = (y >> 1) * (W / 2) + (x >> 1);
				const L = yo[y * W + x];
				const cb = cbo[c] - 128;
				const cr = cro[c] - 128;
				d[i] = L + 1.402 * cr;
				d[i + 1] = L - 0.344136 * cb - 0.714136 * cr;
				d[i + 2] = L + 1.772 * cb;
				d[i + 3] = 255;
			}
		sctx.putImageData(rgb, 0, 0);
		ctx.imageSmoothingEnabled = !p.pixelated;
		ctx.drawImage(src, 0, 0, w, h);
		ctx.imageSmoothingEnabled = true;
	},
};
