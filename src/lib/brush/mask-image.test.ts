import { describe, expect, it } from "bun:test";
import { toMaskPixels } from "./mask-image";

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

describe("toMaskPixels", () => {
	it("reads an opaque image by its brightness", () => {
		const data = px(255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255);
		toMaskPixels(data);
		expect([...data]).toEqual([
			255, 255, 255, 255, 0, 0, 0, 255, 182, 182, 182, 255,
		]);
	});

	it("reads a cutout by its alpha, whatever the colours under it", () => {
		const data = px(0, 0, 0, 255, 255, 255, 255, 0, 10, 20, 30, 128);
		toMaskPixels(data);
		expect([...data]).toEqual([
			255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255,
		]);
	});
});
