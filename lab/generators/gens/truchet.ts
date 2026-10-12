import {
	hashInt,
	makeNoise,
	shuffle,
	unionFind,
	type Generator,
	type Rand,
} from "../kit";

const PI = Math.PI;

export const truchet: Generator = {
	id: "truchet",
	name: "Truchet",
	group: "Graphic & print",
	blurb:
		"Random tiles that join into one pattern: Smith arcs coloured loop by loop, a 10 PRINT maze, a quilt of half-square triangles, or tiles subdivided across scales.",
	params: [
		{
			key: "variant",
			label: "Variant",
			type: "select",
			options: ["Loops", "Maze", "Quilt", "Multiscale"],
			value: "Loops",
		},
		{
			key: "tiles",
			label: "Tiles on short side",
			type: "range",
			min: 3,
			max: 48,
			step: 1,
			value: 12,
		},
		{
			key: "band",
			label: "Band width",
			type: "range",
			min: 0.08,
			max: 0.8,
			value: 0.4,
		},
		{ key: "outline", label: "Outline", type: "bool", value: true },
		{ key: "colorLoops", label: "Colour each path", type: "bool", value: true },
		{
			key: "bias",
			label: "Orientation bias",
			type: "range",
			min: 0,
			max: 1,
			value: 0.5,
		},
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const s = u / (p.tiles as number);
		const cols = Math.ceil(w / s) + 1;
		const rows = Math.ceil(h / s) + 1;
		const ox = (w - cols * s) / 2;
		const oy = (h - rows * s) / 2;
		const bias = p.bias as number;
		const orient = new Uint8Array(cols * rows);
		for (let i = 0; i < orient.length; i++) orient[i] = rng() < bias ? 1 : 0;
		const fills = shuffle(rng, [inks[1], inks[2], inks[3], inks[4]]);
		const colorOf = (root: number) =>
			p.colorLoops ? fills[hashInt(root + 7) % fills.length] : inks[4];
		const line = Math.max(1, u * 0.004);

		ctx.fillStyle = inks[0];
		ctx.fillRect(0, 0, w, h);

		switch (p.variant) {
			case "Maze":
				return maze();
			case "Quilt":
				return quilt();
			case "Multiscale":
				return multiscale();
			default:
				return loops();
		}

		function loops() {
			const H = (rows + 1) * cols;
			const uf = unionFind(H + (cols + 1) * rows);
			const top = (c: number, r: number) => r * cols + c;
			const left = (c: number, r: number) => H + r * (cols + 1) + c;
			for (let r = 0; r < rows; r++)
				for (let c = 0; c < cols; c++) {
					if (orient[r * cols + c] === 0) {
						uf.union(top(c, r), left(c, r));
						uf.union(top(c, r + 1), left(c + 1, r));
					} else {
						uf.union(top(c, r), left(c + 1, r));
						uf.union(top(c, r + 1), left(c, r));
					}
				}
			const band = (p.band as number) * s;
			type Arc = [number, number, number, string];
			const arcs: Arc[] = [];
			for (let r = 0; r < rows; r++)
				for (let c = 0; c < cols; c++) {
					const x = ox + c * s;
					const y = oy + r * s;
					if (orient[r * cols + c] === 0) {
						arcs.push([x, y, 0, colorOf(uf.find(top(c, r)))]);
						arcs.push([x + s, y + s, PI, colorOf(uf.find(top(c, r + 1)))]);
					} else {
						arcs.push([x + s, y, PI / 2, colorOf(uf.find(top(c, r)))]);
						arcs.push([x, y + s, PI * 1.5, colorOf(uf.find(top(c, r + 1)))]);
					}
				}
			ctx.lineCap = "butt";
			if (p.outline) {
				ctx.strokeStyle = inks[0];
				ctx.lineWidth = band + line * 2;
				ctx.beginPath();
				for (const [x, y, a] of arcs) {
					ctx.moveTo(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5);
					ctx.arc(x, y, s / 2, a, a + PI / 2);
				}
				ctx.stroke();
			}
			ctx.lineWidth = band;
			for (const [x, y, a, col] of arcs) {
				ctx.strokeStyle = col;
				ctx.beginPath();
				ctx.arc(x, y, s / 2, a, a + PI / 2);
				ctx.stroke();
			}
		}

		function maze() {
			const node = (c: number, r: number) => r * (cols + 1) + c;
			const uf = unionFind((cols + 1) * (rows + 1));
			for (let r = 0; r < rows; r++)
				for (let c = 0; c < cols; c++)
					if (orient[r * cols + c]) uf.union(node(c, r), node(c + 1, r + 1));
					else uf.union(node(c + 1, r), node(c, r + 1));
			const width = (p.band as number) * s * 0.5;
			ctx.lineCap = "round";
			const segs = (pass: "outline" | "fill") => {
				for (let r = 0; r < rows; r++)
					for (let c = 0; c < cols; c++) {
						const x = ox + c * s;
						const y = oy + r * s;
						const o = orient[r * cols + c];
						ctx.strokeStyle =
							pass === "outline"
								? inks[0]
								: colorOf(uf.find(o ? node(c, r) : node(c + 1, r)));
						ctx.beginPath();
						if (o) {
							ctx.moveTo(x, y);
							ctx.lineTo(x + s, y + s);
						} else {
							ctx.moveTo(x + s, y);
							ctx.lineTo(x, y + s);
						}
						ctx.stroke();
					}
			};
			if (p.outline) {
				ctx.lineWidth = width + line * 2;
				segs("outline");
			}
			ctx.lineWidth = width;
			segs("fill");
		}

		function quilt() {
			const noise = makeNoise(rng);
			const k = 0.35 + rng() * 0.5;
			const tone = (x: number, y: number) =>
				Math.floor((noise(x * k, y * k) * 0.5 + 0.5) * 5 + rng() * 0.6) % 5;
			for (let r = 0; r < rows; r++)
				for (let c = 0; c < cols; c++) {
					const x = ox + c * s;
					const y = oy + r * s;
					const a = tone(c, r);
					const b = (a + 1 + Math.floor(rng() * 2)) % 5;
					ctx.fillStyle = inks[a];
					ctx.fillRect(x, y, s + 0.5, s + 0.5);
					ctx.fillStyle = inks[b];
					ctx.beginPath();
					if (orient[r * cols + c]) {
						ctx.moveTo(x, y);
						ctx.lineTo(x + s + 0.5, y + s + 0.5);
						ctx.lineTo(x, y + s + 0.5);
					} else {
						ctx.moveTo(x + s + 0.5, y);
						ctx.lineTo(x + s + 0.5, y + s + 0.5);
						ctx.lineTo(x, y + s + 0.5);
					}
					ctx.fill();
				}
			if (p.outline) {
				ctx.strokeStyle = inks[0];
				ctx.lineWidth = line * 0.6;
				ctx.beginPath();
				for (let c = 0; c <= cols; c++) {
					ctx.moveTo(ox + c * s, 0);
					ctx.lineTo(ox + c * s, h);
				}
				for (let r = 0; r <= rows; r++) {
					ctx.moveTo(0, oy + r * s);
					ctx.lineTo(w, oy + r * s);
				}
				ctx.stroke();
			}
		}

		function multiscale() {
			const big = s * 4;
			const bc = Math.ceil(w / big) + 1;
			const br = Math.ceil(h / big) + 1;
			const bx = (w - bc * big) / 2;
			const by = (h - br * big) / 2;
			const split = 0.35 + (p.band as number) * 0.4;
			const pairs: [string, string][] = [
				[inks[0], inks[4]],
				[inks[4], inks[0]],
				[inks[1], inks[3]],
				[inks[3], inks[1]],
			];
			const leaf = (
				x: number,
				y: number,
				size: number,
				depth: number,
				r: Rand,
			) => {
				const [bg, fg] = pairs[depth % pairs.length];
				ctx.fillStyle = bg;
				ctx.fillRect(x, y, size, size);
				ctx.strokeStyle = fg;
				ctx.lineWidth = size / 3;
				ctx.lineCap = "butt";
				ctx.beginPath();
				if (r() < 0.5) {
					ctx.arc(x, y, size / 2, 0, PI / 2);
					ctx.moveTo(x + size / 2, y + size);
					ctx.arc(x + size, y + size, size / 2, PI, PI * 1.5);
				} else {
					ctx.arc(x + size, y, size / 2, PI / 2, PI);
					ctx.moveTo(x, y + size / 2);
					ctx.arc(x, y + size, size / 2, PI * 1.5, PI * 2);
				}
				ctx.stroke();
				ctx.fillStyle = fg;
				for (const [cx, cy] of [
					[x + size / 2, y],
					[x + size, y + size / 2],
					[x + size / 2, y + size],
					[x, y + size / 2],
				]) {
					ctx.beginPath();
					ctx.arc(cx, cy, size / 6, 0, PI * 2);
					ctx.fill();
				}
			};
			const tile = (x: number, y: number, size: number, depth: number) => {
				if (depth < 3 && size > u * 0.02 && rng() < split / (depth * 0.4 + 1)) {
					const half = size / 2;
					tile(x, y, half, depth + 1);
					tile(x + half, y, half, depth + 1);
					tile(x, y + half, half, depth + 1);
					tile(x + half, y + half, half, depth + 1);
				} else leaf(x, y, size, depth, rng);
			};
			for (let r = 0; r < br; r++)
				for (let c = 0; c < bc; c++) tile(bx + c * big, by + r * big, big, 0);
		}
	},
};
