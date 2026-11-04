import { describe, expect, test } from "bun:test";
import { wheelGesture, wheelZoomNotches } from "./timeline-viewport.svelte";

const wheel = (over: Partial<Parameters<typeof wheelGesture>[0]> = {}) => ({
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	deltaX: 0,
	deltaY: 100,
	...over,
});

describe("wheelGesture", () => {
	test("a plain wheel scrolls lanes that take it and zooms everything else", () => {
		expect(wheelGesture(wheel(), true)).toBe("scroll");
		expect(wheelGesture(wheel(), false)).toBe("zoom");
	});

	test("Ctrl, Cmd and a pinch zoom over lanes too", () => {
		expect(wheelGesture(wheel({ ctrlKey: true }), true)).toBe("zoom");
		expect(wheelGesture(wheel({ metaKey: true }), true)).toBe("zoom");
	});

	test("Shift and a sideways swipe pan", () => {
		expect(wheelGesture(wheel({ shiftKey: true }), true)).toBe("pan");
		expect(
			wheelGesture(wheel({ shiftKey: true, deltaX: 100, deltaY: 0 }), true),
		).toBe("pan");
		expect(wheelGesture(wheel({ deltaX: 50, deltaY: 10 }), true)).toBe("pan");
	});
});

describe("wheelZoomNotches", () => {
	test("a mouse wheel click is one notch, either way", () => {
		expect(wheelZoomNotches(120, 0)).toBe(1);
		expect(wheelZoomNotches(-120, 0)).toBe(-1);
	});

	test("a pinch's small deltas zoom in proportion", () => {
		expect(wheelZoomNotches(4, 0)).toBeCloseTo(0.1);
	});

	test("line and page deltas are one notch", () => {
		expect(wheelZoomNotches(3, 1)).toBe(1);
		expect(wheelZoomNotches(-1, 2)).toBe(-1);
	});
});
