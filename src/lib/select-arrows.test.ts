import { describe, expect, test } from "bun:test";
import { stepIndex } from "./select-arrows";

describe("stepIndex", () => {
	test("steps to the neighbour", () => {
		expect(stepIndex([true, true, true], 1, 1)).toBe(2);
		expect(stepIndex([true, true, true], 1, -1)).toBe(0);
	});

	test("skips options that can't be picked", () => {
		expect(stepIndex([true, false, false, true], 0, 1)).toBe(3);
		expect(stepIndex([true, false, false, true], 3, -1)).toBe(0);
	});

	test("stays put at either end", () => {
		expect(stepIndex([true, true], 1, 1)).toBe(1);
		expect(stepIndex([true, true], 0, -1)).toBe(0);
		expect(stepIndex([true, false], 0, 1)).toBe(0);
	});

	test("picks the first option when none is selected", () => {
		expect(stepIndex([false, true], -1, 1)).toBe(1);
	});
});
