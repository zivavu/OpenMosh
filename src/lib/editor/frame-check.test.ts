import { describe, expect, it } from "bun:test";
import { mulberry32 } from "../rng";
import { frameLooksDead } from "./frame-check";

const W = 64;
const H = 36;

function frame(lum: (x: number, y: number) => number): Uint8Array {
	const px = new Uint8Array(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const v = Math.round(Math.max(0, Math.min(1, lum(x, y))) * 255);
			px.set([v, v, v, 255], (y * W + x) * 4);
		}
	}
	return px;
}

describe("frameLooksDead", () => {
	it("keeps a picture with shapes and shading", () => {
		const picture = frame(
			(x, y) => 0.5 + 0.35 * Math.sin(x / 7) * Math.cos(y / 5),
		);
		expect(frameLooksDead(picture, W, H)).toBe(false);
	});

	it("throws out black, white and one flat colour", () => {
		expect(
			frameLooksDead(
				frame(() => 0.01),
				W,
				H,
			),
		).toBe(true);
		expect(
			frameLooksDead(
				frame(() => 0.99),
				W,
				H,
			),
		).toBe(true);
		expect(
			frameLooksDead(
				frame(() => 0.5),
				W,
				H,
			),
		).toBe(true);
	});

	it("throws out pure noise", () => {
		const rand = mulberry32(3);
		expect(
			frameLooksDead(
				frame(() => rand()),
				W,
				H,
			),
		).toBe(true);
	});

	it("keeps a picture under light grain", () => {
		const rand = mulberry32(4);
		const grainy = frame(
			(x, y) =>
				0.5 + 0.35 * Math.sin(x / 7) * Math.cos(y / 5) + (rand() - 0.5) * 0.1,
		);
		expect(frameLooksDead(grainy, W, H)).toBe(false);
	});
});
