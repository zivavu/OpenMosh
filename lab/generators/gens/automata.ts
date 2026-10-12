import {
	ctx2d,
	hexRgb,
	int,
	makeCanvas,
	pick,
	ramp,
	type Generator,
	type RGB,
} from "../kit";

const RULES = [
	30, 45, 73, 86, 89, 90, 105, 110, 122, 126, 129, 135, 137, 150, 161, 169, 182,
	193, 225,
];

export const automata: Generator = {
	id: "automata",
	name: "Cellular automata",
	group: "Signal & broadcast",
	blurb:
		"Pixel-exact rule systems: elementary 1D rules printed row by row, cyclic automata growing spiral demons, or an abelian sandpile toppled into a mandala.",
	params: [
		{
			key: "mode",
			label: "Mode",
			type: "select",
			options: ["Elementary", "Cyclic", "Sandpile"],
			value: "Elementary",
		},
		{
			key: "cells",
			label: "Cells on short side",
			type: "range",
			min: 40,
			max: 540,
			step: 1,
			value: 180,
		},
		{
			key: "rule",
			label: "Rule (Elementary)",
			type: "select",
			options: ["Random", ...RULES.map(String)],
			value: "Random",
		},
		{
			key: "start",
			label: "Start row (Elementary)",
			type: "select",
			options: ["Random", "Single", "Sparse"],
			value: "Random",
		},
		{
			key: "states",
			label: "States (Cyclic)",
			type: "range",
			min: 3,
			max: 20,
			step: 1,
			value: 12,
		},
		{
			key: "steps",
			label: "Steps (Cyclic)",
			type: "range",
			min: 20,
			max: 600,
			step: 1,
			value: 220,
		},
		{
			key: "grains",
			label: "Grains, log2 (Sandpile)",
			type: "range",
			min: 10,
			max: 17,
			step: 1,
			value: 14,
		},
		{
			key: "sources",
			label: "Sources (Sandpile)",
			type: "range",
			min: 1,
			max: 4,
			step: 1,
			value: 1,
		},
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const col = ramp(inks);
		const n = p.cells as number;
		let cols = Math.max(4, Math.round((n * w) / u));
		let rows = Math.max(4, Math.round((n * h) / u));
		let pixels: RGB[];
		let grid: Uint8Array;

		if (p.mode === "Elementary") {
			const rule = p.rule === "Random" ? pick(rng, RULES) : Number(p.rule);
			let row = new Uint8Array(cols);
			if (p.start === "Single") row[cols >> 1] = 1;
			else if (p.start === "Sparse")
				for (let i = 0; i < cols; i++) row[i] = rng() < 0.04 ? 1 : 0;
			else for (let i = 0; i < cols; i++) row[i] = rng() < 0.5 ? 1 : 0;
			grid = new Uint8Array(cols * rows);
			const prevPattern = new Uint8Array(cols);
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++)
					grid[r * cols + c] = row[c] ? 1 + (prevPattern[c] % 4) : 0;
				const next = new Uint8Array(cols);
				for (let c = 0; c < cols; c++) {
					const k =
						(row[(c - 1 + cols) % cols] << 2) |
						(row[c] << 1) |
						row[(c + 1) % cols];
					next[c] = (rule >> k) & 1;
					prevPattern[c] = k;
				}
				row = next;
			}
			pixels = [
				hexRgb(inks[0]),
				hexRgb(inks[1]),
				hexRgb(inks[2]),
				hexRgb(inks[3]),
				hexRgb(inks[4]),
			];
			if (rng() < 0.5)
				pixels = [pixels[0], pixels[4], pixels[3], pixels[2], pixels[4]];
		} else if (p.mode === "Cyclic") {
			const N = p.states as number;
			let a = new Uint8Array(cols * rows);
			let b = new Uint8Array(cols * rows);
			for (let i = 0; i < a.length; i++) a[i] = Math.floor(rng() * N);
			const thresh = int(rng, 1, 3);
			const range = thresh > 1 ? 2 : 1;
			const steps = p.steps as number;
			for (let s = 0; s < steps; s++) {
				for (let y = 0; y < rows; y++)
					for (let x = 0; x < cols; x++) {
						const v = a[y * cols + x];
						const nx = (v + 1) % N;
						let count = 0;
						for (let dy = -range; dy <= range && count < thresh; dy++) {
							const yy = (y + dy + rows) % rows;
							for (let dx = -range; dx <= range; dx++) {
								if (!dx && !dy) continue;
								if (
									a[yy * cols + ((x + dx + cols) % cols)] === nx &&
									++count >= thresh
								)
									break;
							}
						}
						b[y * cols + x] = count >= thresh ? nx : v;
					}
				[a, b] = [b, a];
			}
			grid = a;
			pixels = Array.from({ length: N }, (_, s) =>
				col(1 - Math.abs((2 * s) / N - 1)),
			);
		} else {
			const grains = 2 ** (p.grains as number);
			const sources = p.sources as number;
			const radius = Math.ceil(Math.sqrt(grains / (2.1 * Math.PI)) * 1.15) + 2;
			const spread = sources > 1 ? radius * 0.9 : 0;
			const side = Math.ceil((radius + spread) * 2 + 4);
			cols = Math.ceil((side * w) / u);
			rows = Math.ceil((side * h) / u);
			const pile = new Uint32Array(cols * rows);
			for (let k = 0; k < sources; k++) {
				const a = (k / sources) * Math.PI * 2 + rng();
				const x = Math.round(
					cols / 2 + Math.cos(a) * spread * (sources > 1 ? 0.6 : 0),
				);
				const y = Math.round(
					rows / 2 + Math.sin(a) * spread * (sources > 1 ? 0.6 : 0),
				);
				pile[y * cols + x] += Math.floor(grains / sources);
			}
			const x0 = Math.max(1, Math.floor((cols - side) / 2));
			const y0 = Math.max(1, Math.floor((rows - side) / 2));
			const x1 = Math.min(cols - 1, x0 + side);
			const y1 = Math.min(rows - 1, y0 + side);
			let busy = true;
			while (busy) {
				busy = false;
				for (let y = y0; y < y1; y++)
					for (let x = x0; x < x1; x++) {
						const i = y * cols + x;
						const v = pile[i];
						if (v < 4) continue;
						const q = v >> 2;
						pile[i] = v & 3;
						pile[i - 1] += q;
						pile[i + 1] += q;
						pile[i - cols] += q;
						pile[i + cols] += q;
						busy = true;
					}
			}
			grid = new Uint8Array(cols * rows);
			for (let i = 0; i < grid.length; i++) grid[i] = Math.min(pile[i], 3);
			pixels = [
				hexRgb(inks[0]),
				hexRgb(inks[2]),
				hexRgb(inks[3]),
				hexRgb(inks[4]),
			];
		}

		const c = makeCanvas(cols, rows);
		const cctx = ctx2d(c);
		const img = cctx.createImageData(cols, rows);
		for (let i = 0; i < grid.length; i++) {
			const px = pixels[grid[i]];
			img.data[i * 4] = px[0];
			img.data[i * 4 + 1] = px[1];
			img.data[i * 4 + 2] = px[2];
			img.data[i * 4 + 3] = 255;
		}
		cctx.putImageData(img, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(c, 0, 0, w, h);
		ctx.imageSmoothingEnabled = true;
	},
};
