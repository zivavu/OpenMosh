import { describe, expect, test } from "bun:test";
import { dragCrop, edgesAt, startCropDrag } from "./crop-drag";
import { FULL_CROP } from "./source-edit";

const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
const tol = { x: 0.02, y: 0.02 };

describe("startCropDrag", () => {
	test("outside the rectangle starts a new one", () => {
		const { drag, crop } = startCropDrag(box, { x: 0.9, y: 0.9 }, tol);
		expect(drag.kind).toBe("new");
		expect(crop?.x).toBeCloseTo(0.9);
	});

	test("inside moves it, on an edge resizes it", () => {
		expect(startCropDrag(box, { x: 0.4, y: 0.4 }, tol).drag.kind).toBe("move");
		expect(startCropDrag(box, { x: 0.6, y: 0.4 }, tol).drag.kind).toBe(
			"resize",
		);
	});

	test("a full frame has no edges to grab", () => {
		expect(edgesAt(FULL_CROP, { x: 0, y: 0 }, tol)).toBeNull();
	});
});

describe("dragCrop", () => {
	test("a new rectangle spans the press and the pointer either way round", () => {
		const r = dragCrop({ kind: "new", ax: 0.8, ay: 0.7 }, box, {
			x: 0.3,
			y: 0.2,
		});
		expect(r.x).toBeCloseTo(0.3);
		expect(r.y).toBeCloseTo(0.2);
		expect(r.w).toBeCloseTo(0.5);
		expect(r.h).toBeCloseTo(0.5);
	});

	test("a move stays inside the frame", () => {
		const r = dragCrop({ kind: "move", dx: 0.2, dy: 0.2 }, box, {
			x: 1,
			y: 1,
		});
		expect(r.x + r.w).toBeCloseTo(1);
		expect(r.y + r.h).toBeCloseTo(1);
	});

	test("a held edge stops at the opposite one", () => {
		const edges = { l: true, r: false, t: false, b: false };
		const r = dragCrop({ kind: "resize", edges, from: box }, box, {
			x: 0.95,
			y: 0.4,
		});
		expect(r.x + r.w).toBeCloseTo(0.6);
		expect(r.w).toBeGreaterThan(0);
	});
});
