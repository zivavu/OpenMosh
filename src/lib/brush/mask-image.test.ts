import { describe, expect, it } from "bun:test";
import { toMaskPixels } from "./mask-image";

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

describe("toMaskPixels", () => {
	it("greys an opaque image by brightness and calls it no cutout", () => {
		const data = px(255, 255, 255, 255, 0, 255, 0, 255);
		expect(toMaskPixels(data)).toBe(false);
		expect([...data]).toEqual([255, 255, 255, 255, 182, 182, 182, 255]);
	});

	it("keeps transparency as it is and flags a cutout", () => {
		const data = px(255, 0, 0, 0, 10, 20, 30, 128);
		expect(toMaskPixels(data)).toBe(true);
		expect([data[3], data[7]]).toEqual([0, 128]);
	});
});
