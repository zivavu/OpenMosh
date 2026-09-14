import { describe, expect, test } from "bun:test";
import { decodeGif } from "./gif";

const fixtures = [
	{ name: "terraria.gif", frames: 2 },
	{ name: "dancing-mushroom.gif", frames: 10 },
];

describe("decodeGif", () => {
	for (const { name, frames } of fixtures) {
		test(`${name} decodes every frame`, async () => {
			const bytes = new Uint8Array(
				await Bun.file(
					new URL(`./fixtures/${name}`, import.meta.url),
				).arrayBuffer(),
			);
			const gif = decodeGif(bytes);
			expect(gif.width).toBeGreaterThan(0);
			expect(gif.height).toBeGreaterThan(0);
			expect(gif.frames.length).toBeGreaterThanOrEqual(frames);
			// Consecutive frames differ: a broken decoder tends to produce blanks
			// or repeats of the first frame.
			const opaque = (f: Uint8ClampedArray) =>
				f.filter((_, i) => i % 4 === 3 && f[i] > 0).length;
			for (const f of gif.frames) {
				expect(f.delayMs).toBeGreaterThanOrEqual(20);
				expect(opaque(f.pixels)).toBeGreaterThan(0);
			}
			const distinct = new Set(gif.frames.map((f) => f.pixels.join(",")));
			expect(distinct.size).toBeGreaterThan(1);
		});
	}

	test("rejects non-GIF data", () => {
		expect(() => decodeGif(new Uint8Array(20))).toThrow("not a GIF");
	});
});
