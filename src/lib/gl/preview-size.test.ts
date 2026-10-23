import { describe, expect, it } from "bun:test";
import { fitPreviewSize, fitTextureSize } from "./preview-size";

describe("fitPreviewSize", () => {
	it("fits the output into the displayed box without upscaling", () => {
		expect(fitPreviewSize(1920, 1080, 960, 960)).toEqual({
			width: 960,
			height: 540,
		});
		expect(fitPreviewSize(640, 360, 1920, 1080)).toEqual({
			width: 640,
			height: 360,
		});
	});

	it("bounds an unmeasured display instead of taking the output size", () => {
		// A hidden or not-yet-laid-out preview measures 0. Handing back 2160x3840
		// there allocated every buffer at 8 megapixels, enough to kill the GPU process.
		const size = fitPreviewSize(2160, 3840, 0, 0)!;
		expect(size.width * size.height).toBeLessThanOrEqual(1280 * 720);
		expect(size.width / size.height).toBeCloseTo(2160 / 3840, 2);
	});

	it("leaves a small output alone when the display is unmeasured", () => {
		expect(fitPreviewSize(640, 360, 0, 0)).toEqual({ width: 640, height: 360 });
	});

	it("has nothing to fit without an output size", () => {
		expect(fitPreviewSize(undefined, undefined, 800, 600)).toBeNull();
		expect(fitPreviewSize(0, 1080, 800, 600)).toBeNull();
	});
});

describe("fitTextureSize", () => {
	it("leaves a size under the limit alone", () => {
		expect(fitTextureSize(4032, 3024, 8192)).toEqual({
			width: 4032,
			height: 3024,
		});
	});

	it("shrinks the long side to the limit, keeping the shape", () => {
		expect(fitTextureSize(12000, 9000, 8192)).toEqual({
			width: 8192,
			height: 6144,
		});
	});
});
