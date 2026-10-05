import { describe, expect, it } from "bun:test";
import {
	moveShape,
	readShape,
	rotateShape,
	scaleShape,
	shapeGeometry,
	shapeHandle,
	type ShapeValues,
} from "./mask-shape";

const W = 400;
const H = 200;
const shape: ShapeValues = {
	x: 0.5,
	y: 0.5,
	width: 0.5,
	height: 0.5,
	angle: 0,
};

describe("shapeGeometry", () => {
	it("measures size in the box's short edge, so equal sides are square", () => {
		const g = shapeGeometry(shape, W, H);
		expect(g.sw).toBe(100);
		expect(g.sh).toBe(100);
		expect([g.cx, g.cy]).toEqual([200, 100]);
	});
});

describe("moveShape", () => {
	it("moves by the drag, in box uv", () => {
		const moved = moveShape(shape, 40, -20, W, H);
		expect(moved.x).toBeCloseTo(0.6);
		expect(moved.y).toBeCloseTo(0.4);
	});

	it("keeps the centre on the box, where the sliders reach", () => {
		const moved = moveShape(shape, 5000, 5000, W, H);
		expect(moved.x).toBe(1);
		expect(moved.y).toBe(1);
	});
});

describe("scaleShape", () => {
	it("drags one edge out with the other side staying put", () => {
		// The right edge sits at x = 250; pull it to 350.
		const g = shapeHandle(shape, 1, 0, W, H);
		const next = scaleShape(shape, g, 350, 100, W, H, false);
		expect(next.width).toBeCloseTo(1);
		expect(next.height).toBeCloseTo(0.5);
		expect(next.x * W - (next.width * H) / 2).toBeCloseTo(150);
	});

	it("scales about the centre with Alt", () => {
		const g = shapeHandle(shape, 1, 1, W, H);
		const next = scaleShape(shape, g, 300, 200, W, H, true);
		expect(next.width).toBeCloseTo(1);
		expect(next.height).toBeCloseTo(1);
		expect(next.x).toBeCloseTo(0.5);
	});
});

describe("rotateShape", () => {
	it("turns clockwise by the pointer's sweep round the centre", () => {
		const g = { cx: 200, cy: 100, a0: Math.atan2(-50, 0) };
		expect(rotateShape(shape, g, 250, 100, false).angle).toBeCloseTo(90);
	});
});

describe("readShape", () => {
	it("falls back to the params' defaults", () => {
		expect(readShape({ shape: "ellipse" })).toEqual({
			x: 0.5,
			y: 0.5,
			width: 0.6,
			height: 0.6,
			angle: 0,
		});
	});
});
