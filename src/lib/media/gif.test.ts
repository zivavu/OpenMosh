import { describe, expect, it } from "bun:test";
import { decodeGif, evenSize } from "./gif";

const HEADER = [
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0,
	// Two-colour global palette: red, blue.
	0xff, 0, 0, 0, 0, 0xff,
];
/** A 1x1 frame of palette index 0, after a 50ms graphic control block. */
const FRAME = [
	0x21, 0xf9, 4, 0, 5, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44,
	0x01, 0,
];
const TRAILER = [0x3b];

const gif = (...parts: number[][]) => new Uint8Array(parts.flat());

/** GIF-flavoured LZW, the textbook encoder: indices into codes, packed LSB first. */
function lzwEncode(indices: number[], minCodeSize: number): number[] {
	const clear = 1 << minCodeSize;
	const eoi = clear + 1;
	let codeSize = minCodeSize + 1;
	let next = eoi + 1;
	let dict = new Map<string, number>();
	const bytes: number[] = [];
	let acc = 0;
	let bits = 0;
	const write = (code: number) => {
		acc |= code << bits;
		bits += codeSize;
		while (bits >= 8) {
			bytes.push(acc & 0xff);
			acc >>= 8;
			bits -= 8;
		}
	};
	write(clear);
	let run = String(indices[0]);
	for (const index of indices.slice(1)) {
		const grown = `${run},${index}`;
		if (dict.has(grown)) {
			run = grown;
			continue;
		}
		write(run.includes(",") ? dict.get(run)! : Number(run));
		if (next < 4096) {
			dict.set(grown, next++);
			if (next > 1 << codeSize && codeSize < 12) codeSize++;
		} else {
			write(clear);
			dict = new Map();
			codeSize = minCodeSize + 1;
			next = eoi + 1;
		}
		run = String(index);
	}
	write(run.includes(",") ? dict.get(run)! : Number(run));
	write(eoi);
	if (bits > 0) bytes.push(acc & 0xff);
	const blocks: number[] = [];
	for (let i = 0; i < bytes.length; i += 255) {
		const chunk = bytes.slice(i, i + 255);
		blocks.push(chunk.length, ...chunk);
	}
	return [minCodeSize, ...blocks, 0];
}

describe("decodeGif", () => {
	it("decodes every frame with its delay", () => {
		const out = decodeGif(gif(HEADER, FRAME, FRAME, TRAILER));
		expect(out.width).toBe(1);
		expect(out.height).toBe(1);
		expect(out.frames.map((f) => f.delayMs)).toEqual([50, 50]);
		expect([...out.frames[0].pixels]).toEqual([255, 0, 0, 255]);
	});

	it("decodes encoded frames back to the same pixels", () => {
		// Four colours: red, green, blue, white.
		const palette = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];
		let seed = 7;
		const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
		for (const [w, h] of [
			[16, 16],
			[64, 48],
			[200, 120],
		]) {
			// Runs as well as noise, so the dictionary both grows and resets.
			const indices = Array.from({ length: w * h }, (_, i) =>
				i % 97 < 40 ? 1 : random() % 4,
			);
			const header = [
				0x47,
				0x49,
				0x46,
				0x38,
				0x39,
				0x61,
				w & 0xff,
				w >> 8,
				h & 0xff,
				h >> 8,
				0x81,
				0,
				0,
				...palette,
			];
			const frame = [0x2c, 0, 0, 0, 0, w & 0xff, w >> 8, h & 0xff, h >> 8, 0];
			const out = decodeGif(gif(header, frame, lzwEncode(indices, 2), TRAILER));
			const pixels = out.frames[0].pixels;
			const decoded = Array.from(
				{ length: w * h },
				(_, i) =>
					palette.findIndex(
						(_, c) =>
							c % 3 === 0 &&
							palette[c] === pixels[i * 4] &&
							palette[c + 1] === pixels[i * 4 + 1] &&
							palette[c + 2] === pixels[i * 4 + 2],
					) / 3,
			);
			expect(decoded).toEqual(indices);
		}
	});

	it("keeps the frames before a cut inside a block", () => {
		const cut = gif(HEADER, FRAME, FRAME.slice(0, 3));
		expect(decodeGif(cut).frames).toHaveLength(1);
	});

	it("keeps the frames before a cut inside image data", () => {
		const cut = gif(HEADER, FRAME, FRAME.slice(0, 20));
		expect(decodeGif(cut).frames.length).toBeGreaterThanOrEqual(1);
	});

	it("stops at image data that names codes the dictionary doesn't hold yet", () => {
		// A 4x4 frame: min code size 2, then codes 6, 6, 6 and end-of-image, 3 bits each.
		const crafted = [0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0, 2, 2, 0xb6, 0x0b, 0];
		const out = decodeGif(gif(HEADER, crafted, TRAILER));
		expect(out.frames).toHaveLength(1);
	});

	it("stops at a comment that claims more bytes than the file has", () => {
		const cut = gif(HEADER, FRAME, [0x21, 0xfe, 0x05, 0x41, 0x42]);
		expect(decodeGif(cut).frames).toHaveLength(1);
	});
});

describe("evenSize", () => {
	it("drops an odd last row or column, so hardware decoders take the video", () => {
		expect(evenSize({ width: 498, height: 485 })).toEqual({
			width: 498,
			height: 484,
		});
		expect(evenSize({ width: 1, height: 1 })).toEqual({ width: 2, height: 2 });
	});
});
