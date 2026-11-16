import { describe, expect, test } from "bun:test";
import { keyGridOf, nextGridLine, onGrid, onGridWithin } from "./key-grid";

describe("key grid", () => {
	// 120 BPM in half beats: a line every 0.25s from 0.1s.
	const grid = keyGridOf(120, 0.1, 0.5)!;

	test("spaces its lines by the division, from the song's first beat", () => {
		expect(grid).toEqual({ step: 0.25, offset: 0.1 });
	});

	test("has no grid without a tempo", () => {
		expect(keyGridOf(0, 0, 1)).toBeNull();
	});

	test("puts a time on the nearest line", () => {
		expect(onGrid(0.4, grid)).toBeCloseTo(0.35);
		expect(onGrid(0.5, grid)).toBeCloseTo(0.6);
	});

	test("steps line to line, and from between lines to the one that way", () => {
		expect(nextGridLine(0.35, grid, 1)).toBeCloseTo(0.6);
		expect(nextGridLine(0.35, grid, -1)).toBeCloseTo(0.1);
		expect(nextGridLine(0.4, grid, 1)).toBeCloseTo(0.6);
		expect(nextGridLine(0.4, grid, -1)).toBeCloseTo(0.35);
	});

	test("keeps to a span, taking the nearest line inside it", () => {
		expect(onGridWithin(0.4, grid, 0.38, 2)).toBeCloseTo(0.6);
		expect(onGridWithin(0.4, grid, 0.36, 0.5)).toBeCloseTo(0.4);
	});
});
