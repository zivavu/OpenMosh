import { grain, int, luma, shuffle, type Generator, type Rand } from "../kit";

type Motif = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	s: number,
	fg: string,
	alt: string,
	rng: Rand,
	line: number,
) => void;

const PI = Math.PI;

/** Corner index 0..3 = TL, TR, BR, BL; returns the corner and the quarter it opens into. */
function corner(
	x: number,
	y: number,
	s: number,
	c: number,
): [number, number, number] {
	return c === 0
		? [x, y, 0]
		: c === 1
			? [x + s, y, PI / 2]
			: c === 2
				? [x + s, y + s, PI]
				: [x, y + s, PI * 1.5];
}

const quarter: Motif = (ctx, x, y, s, fg, _alt, rng) => {
	const [cx, cy, a] = corner(x, y, s, int(rng, 0, 3));
	ctx.fillStyle = fg;
	ctx.beginPath();
	ctx.moveTo(cx, cy);
	ctx.arc(cx, cy, s, a, a + PI / 2);
	ctx.fill();
};

const half: Motif = (ctx, x, y, s, fg, _alt, rng) => {
	const side = int(rng, 0, 3);
	const [cx, cy] =
		side === 0
			? [x + s / 2, y]
			: side === 1
				? [x + s, y + s / 2]
				: side === 2
					? [x + s / 2, y + s]
					: [x, y + s / 2];
	ctx.fillStyle = fg;
	ctx.beginPath();
	ctx.arc(cx, cy, s / 2, 0, PI * 2);
	ctx.fill();
};

const target: Motif = (ctx, x, y, s, fg, alt, rng) => {
	const rings = int(rng, 1, 3);
	for (let i = 0; i < rings; i++) {
		ctx.fillStyle = i % 2 ? alt : fg;
		ctx.beginPath();
		ctx.arc(x + s / 2, y + s / 2, (s / 2) * (1 - i / rings) * 0.92, 0, PI * 2);
		ctx.fill();
	}
};

const diagonal: Motif = (ctx, x, y, s, fg, _alt, rng) => {
	ctx.fillStyle = fg;
	ctx.beginPath();
	if (rng() < 0.5) {
		ctx.moveTo(x, y);
		ctx.lineTo(x + s, y + s);
		ctx.lineTo(x, y + s);
	} else {
		ctx.moveTo(x + s, y);
		ctx.lineTo(x + s, y + s);
		ctx.lineTo(x, y + s);
	}
	ctx.fill();
};

const stripes: Motif = (ctx, x, y, s, fg, _alt, rng) => {
	const n = int(rng, 3, 7);
	const vertical = rng() < 0.5;
	ctx.fillStyle = fg;
	for (let i = 0; i < n; i += 2) {
		const a = (i / n) * s;
		if (vertical) ctx.fillRect(x + a, y, s / n, s);
		else ctx.fillRect(x, y + a, s, s / n);
	}
};

const rainbow: Motif = (ctx, x, y, s, fg, alt, rng) => {
	const [cx, cy, a] = corner(x, y, s, int(rng, 0, 3));
	const n = int(rng, 3, 5);
	for (let i = 0; i < n; i++) {
		ctx.fillStyle = i % 2 ? alt : fg;
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.arc(cx, cy, s * (1 - i / n), a, a + PI / 2);
		ctx.fill();
	}
};

const leaf: Motif = (ctx, x, y, s, fg, _alt, rng) => {
	const flip = rng() < 0.5;
	ctx.fillStyle = fg;
	ctx.beginPath();
	if (flip) {
		ctx.arc(x, y + s, s, -PI / 2, 0);
		ctx.arc(x + s, y, s, PI / 2, PI);
	} else {
		ctx.arc(x, y, s, 0, PI / 2);
		ctx.arc(x + s, y + s, s, PI, PI * 1.5);
	}
	ctx.fill();
};

const dots: Motif = (ctx, x, y, s, fg, _alt, rng) => {
	const n = int(rng, 2, 4);
	ctx.fillStyle = fg;
	for (let j = 0; j < n; j++)
		for (let i = 0; i < n; i++) {
			ctx.beginPath();
			ctx.arc(
				x + ((i + 0.5) / n) * s,
				y + ((j + 0.5) / n) * s,
				(s / n) * 0.3,
				0,
				PI * 2,
			);
			ctx.fill();
		}
};

const squiggle: Motif = (ctx, x, y, s, fg, _alt, rng, line) => {
	const waves = int(rng, 2, 4);
	const amp = s * (0.08 + rng() * 0.1);
	const rows = int(rng, 1, 3);
	ctx.strokeStyle = fg;
	ctx.lineWidth = Math.max(line * 2.2, s * 0.06);
	ctx.lineCap = "round";
	for (let r = 0; r < rows; r++) {
		const yy = y + ((r + 1) / (rows + 1)) * s;
		ctx.beginPath();
		for (let i = 0; i <= 40; i++) {
			const t = i / 40;
			const px = x + s * 0.1 + t * s * 0.8;
			const py = yy + Math.sin(t * waves * PI * 2) * amp;
			if (i) ctx.lineTo(px, py);
			else ctx.moveTo(px, py);
		}
		ctx.stroke();
	}
};

const zigzag: Motif = (ctx, x, y, s, fg, _alt, rng, line) => {
	const n = int(rng, 3, 6);
	ctx.strokeStyle = fg;
	ctx.lineWidth = Math.max(line * 2.2, s * 0.05);
	ctx.lineJoin = "miter";
	for (let r = 0; r < 2; r++) {
		const yy = y + s * (0.35 + r * 0.3);
		ctx.beginPath();
		for (let i = 0; i <= n * 2; i++) {
			const px = x + s * 0.08 + (i / (n * 2)) * s * 0.84;
			const py = yy + (i % 2 ? -1 : 1) * s * 0.08;
			if (i) ctx.lineTo(px, py);
			else ctx.moveTo(px, py);
		}
		ctx.stroke();
	}
};

const confetti: Motif = (ctx, x, y, s, fg, alt, rng, line) => {
	const n = int(rng, 6, 14);
	ctx.lineCap = "round";
	for (let i = 0; i < n; i++) {
		const px = x + s * (0.1 + rng() * 0.8);
		const py = y + s * (0.1 + rng() * 0.8);
		const a = rng() * PI;
		const l = s * (0.05 + rng() * 0.08);
		ctx.strokeStyle = rng() < 0.5 ? fg : alt;
		ctx.lineWidth = Math.max(line * 2, s * 0.03);
		ctx.beginPath();
		ctx.moveTo(px - Math.cos(a) * l, py - Math.sin(a) * l);
		ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
		ctx.stroke();
	}
};

const triangle: Motif = (ctx, x, y, s, fg) => {
	ctx.fillStyle = fg;
	ctx.beginPath();
	ctx.moveTo(x + s / 2, y + s * 0.12);
	ctx.lineTo(x + s * 0.9, y + s * 0.85);
	ctx.lineTo(x + s * 0.1, y + s * 0.85);
	ctx.closePath();
	ctx.fill();
};

const BAUHAUS: [Motif, number][] = [
	[quarter, 3],
	[half, 2],
	[target, 1.5],
	[diagonal, 1.5],
	[stripes, 1],
	[rainbow, 1.5],
	[leaf, 1.5],
	[dots, 0.7],
	[() => {}, 0.8],
];

const MEMPHIS: [Motif, number][] = [
	[squiggle, 2],
	[zigzag, 1.2],
	[confetti, 1.5],
	[dots, 1.2],
	[triangle, 1],
	[half, 1],
	[stripes, 1],
	[quarter, 0.8],
	[() => {}, 0.6],
];

function weighted<T>(rng: Rand, items: [T, number][]): T {
	const total = items.reduce((s, [, w]) => s + w, 0);
	let r = rng() * total;
	for (const [v, w] of items) if ((r -= w) <= 0) return v;
	return items[items.length - 1][0];
}

export const bauhaus: Generator = {
	id: "bauhaus",
	name: "Bauhaus / Memphis",
	group: "Graphic & print",
	blurb:
		"A grid of flat geometric motifs placed by rules, not noise: quarter circles, rainbows and leaves, or Memphis squiggles and confetti.",
	params: [
		{
			key: "grid",
			label: "Cells on short side",
			type: "range",
			min: 2,
			max: 10,
			step: 1,
			value: 4,
		},
		{
			key: "style",
			label: "Style",
			type: "select",
			options: ["Bauhaus", "Memphis", "Mixed"],
			value: "Bauhaus",
		},
		{
			key: "big",
			label: "Big-cell chance",
			type: "range",
			min: 0,
			max: 0.8,
			value: 0.25,
		},
		{ key: "outline", label: "Ink outlines", type: "bool", value: false },
		{ key: "gap", label: "Gutter", type: "range", min: 0, max: 0.15, value: 0 },
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const n = p.grid as number;
		const cell = u / n;
		const cols = Math.ceil(w / cell);
		const rows = Math.ceil(h / cell);
		const ox = (w - cols * cell) / 2;
		const oy = (h - rows * cell) / 2;
		const taken = new Uint8Array(cols * rows);
		const line = u * 0.006;
		const gap = (p.gap as number) * cell;
		const ink0 = luma(inks[0]) < 0.2 ? inks[0] : "#111";

		ctx.fillStyle = p.gap ? inks[4] : inks[0];
		ctx.fillRect(0, 0, w, h);

		const style = p.style as string;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				if (taken[r * cols + c]) continue;
				let span = 1;
				if (
					c + 1 < cols &&
					r + 1 < rows &&
					!taken[r * cols + c + 1] &&
					rng() < (p.big as number)
				)
					span = 2;
				for (let j = 0; j < span; j++)
					for (let i = 0; i < span; i++) taken[(r + j) * cols + c + i] = 1;

				const s = cell * span - gap;
				const x = ox + c * cell + gap / 2;
				const y = oy + r * cell + gap / 2;
				const order = shuffle(rng, [0, 1, 2, 3, 4]);
				const bg = inks[order[0]];
				const fg = inks[order[1]];
				const alt = inks[order[2]];
				const memphis =
					style === "Memphis" || (style === "Mixed" && rng() < 0.5);
				const motif = weighted(rng, memphis ? MEMPHIS : BAUHAUS);

				ctx.save();
				ctx.beginPath();
				ctx.rect(x, y, s, s);
				ctx.clip();
				ctx.fillStyle = bg;
				ctx.fillRect(x, y, s, s);
				motif(ctx, x, y, s, fg, alt, rng, line);
				if (memphis && rng() < 0.3)
					confetti(ctx, x, y, s, ink0, alt, rng, line);
				ctx.restore();
				if (p.outline) {
					ctx.strokeStyle = ink0;
					ctx.lineWidth = line;
					ctx.strokeRect(x, y, s, s);
				}
			}
		}
		grain(env, 0.03);
	},
};
