import { describe, expect, test } from "bun:test";
import { isPlainShape, PLAIN_SHAPE, shapeLayout } from "./shape";

/** Where camera pixel (x, y) lands in the output. */
function place(l: ReturnType<typeof shapeLayout>, x: number, y: number) {
	return { x: l.a * x + l.e, y: l.d * y + l.f };
}

describe("shapeLayout", () => {
	test("a plain shape draws the frame as it is", () => {
		const l = shapeLayout(1280, 720, PLAIN_SHAPE);
		expect(l).toMatchObject({ width: 1280, height: 720, a: 1, d: 1 });
		expect(place(l, 0, 0)).toEqual({ x: 0, y: 0 });
	});

	test("a horizontal flip mirrors the frame", () => {
		const l = shapeLayout(1280, 720, { ...PLAIN_SHAPE, flipX: true });
		expect(place(l, 0, 0)).toEqual({ x: 1280, y: 0 });
		expect(place(l, 1280, 720)).toEqual({ x: 0, y: 720 });
	});

	test("a crop keeps its corner at the output's origin", () => {
		const crop = { x: 0.25, y: 0.5, w: 0.5, h: 0.5 };
		const l = shapeLayout(1280, 720, { ...PLAIN_SHAPE, crop });
		expect(l.width).toBe(640);
		expect(l.height).toBe(360);
		expect(place(l, 320, 360)).toEqual({ x: 0, y: 0 });
	});

	test("the crop is taken from the flipped picture", () => {
		const crop = { x: 0, y: 0, w: 0.5, h: 1 };
		const l = shapeLayout(1000, 500, { ...PLAIN_SHAPE, flipX: true, crop });
		// The left half of what the panel shows is the camera's right half.
		expect(place(l, 1000, 0).x).toBe(0);
		expect(place(l, 500, 0).x).toBe(500);
	});

	test("output sides are even, for the encoder", () => {
		const crop = { x: 0, y: 0, w: 0.333, h: 0.333 };
		const l = shapeLayout(1280, 720, { ...PLAIN_SHAPE, crop });
		expect(l.width % 2).toBe(0);
		expect(l.height % 2).toBe(0);
	});
});

test("isPlainShape", () => {
	expect(isPlainShape(PLAIN_SHAPE)).toBe(true);
	expect(isPlainShape({ ...PLAIN_SHAPE, flipY: true })).toBe(false);
	expect(
		isPlainShape({ ...PLAIN_SHAPE, crop: { x: 0.1, y: 0, w: 0.9, h: 1 } }),
	).toBe(false);
});
