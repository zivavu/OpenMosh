import { describe, expect, test } from "bun:test";
import { FINE_DRAG, FinePointer, rangeValueAfter } from "./fine-drag";

const at = (clientX: number, ctrlKey = false, clientY = 0) => ({
	clientX,
	clientY,
	ctrlKey,
	metaKey: false,
});

describe("FinePointer", () => {
	test("follows the pointer without Ctrl", () => {
		const p = new FinePointer(at(100));
		expect(p.move(at(150)).x).toBe(150);
	});

	test("moves a tenth as far with Ctrl held", () => {
		const p = new FinePointer(at(100));
		expect(p.move(at(200, true)).x).toBeCloseTo(100 + 100 * FINE_DRAG);
	});

	test("keeps the slow stretch when Ctrl lets go mid-drag", () => {
		const p = new FinePointer(at(0));
		p.move(at(100, true));
		expect(p.move(at(150)).x).toBeCloseTo(10 + 50);
	});

	test("slows the vertical too", () => {
		const p = new FinePointer(at(0, false, 0));
		expect(p.move(at(0, true, 50)).y).toBeCloseTo(5);
	});
});

describe("rangeValueAfter", () => {
	test("moves by the share of the track the thumb crossed", () => {
		expect(rangeValueAfter(50, 20, 200, 0, 100)).toBe(60);
	});

	test("stays inside the slider's range", () => {
		expect(rangeValueAfter(95, 100, 200, 0, 100)).toBe(100);
		expect(rangeValueAfter(5, -100, 200, 0, 100)).toBe(0);
	});

	test("holds still on a track with no width", () => {
		expect(rangeValueAfter(30, 50, 0, 0, 100)).toBe(30);
	});
});
