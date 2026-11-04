import { describe, expect, test } from "bun:test";
import {
	formatField,
	hundredths,
	parseField,
	percent,
	percentOf,
	speedFactor,
	stepField,
} from "./value-field";

const unit = { min: 0, max: 1, step: 0.01 };

describe("formatField", () => {
	test("shows the slider's read-out units", () => {
		expect(formatField(0.75, percent)).toBe("75");
		expect(formatField(0.5, hundredths)).toBe("50");
		expect(formatField(0.15, percentOf(0.3))).toBe("50");
		expect(formatField(-1, speedFactor)).toBe("0.5");
	});

	test("trims float noise", () => {
		expect(formatField(0.1 + 0.2)).toBe("0.3");
		expect(formatField(0.07, percent)).toBe("7");
	});
});

describe("parseField", () => {
	test("reads a plain number", () => {
		expect(parseField("0.5", unit)).toBe(0.5);
	});

	test("converts from the shown units", () => {
		expect(parseField("75", { ...unit, display: percent })).toBe(0.75);
		expect(
			parseField("1.5", { min: -2, max: 2, step: 0.05, display: speedFactor }),
		).toBeCloseTo(Math.log2(1.5), 5);
	});

	test("clamps to the slider's range", () => {
		expect(parseField("500", { ...unit, display: percent })).toBe(1);
		expect(parseField("-3", unit)).toBe(0);
		expect(
			parseField("0", { min: -2, max: 2, step: 0.05, display: speedFactor }),
		).toBe(-2);
	});

	test("keeps precision finer than a fractional step", () => {
		expect(parseField("0.123", unit)).toBe(0.123);
	});

	test("rounds on whole-number sliders", () => {
		expect(parseField("3.6", { min: 1, max: 20, step: 1 })).toBe(4);
	});

	test("refuses what isn't a value", () => {
		expect(parseField("", unit)).toBeNull();
		expect(parseField("  ", unit)).toBeNull();
		expect(parseField("abc", unit)).toBeNull();
		expect(
			parseField("-1", { min: -2, max: 2, step: 0.05, display: speedFactor }),
		).toBeNull();
	});
});

describe("stepField", () => {
	test("moves by the slider's step, ten at a time when coarse", () => {
		expect(stepField(0.5, 1, false, unit)).toBe(0.51);
		expect(stepField(0.5, -1, true, unit)).toBe(0.4);
	});

	test("stops at the ends", () => {
		expect(stepField(1, 1, false, unit)).toBe(1);
		expect(stepField(0, -1, true, unit)).toBe(0);
	});
});
