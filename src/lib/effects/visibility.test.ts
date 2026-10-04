import { describe, expect, it } from "bun:test";
import type { EffectParam } from "./types";
import { isParamVisible } from "./visibility";

const axis: EffectParam = {
	key: "axis",
	label: "Spin Axis",
	type: "select",
	defaultValue: "y",
	options: [{ label: "Y", value: "y" }],
	visibleWhen: (v) => (v.spin as number) > 0,
};

describe("isParamVisible", () => {
	it("follows the value when nothing is linked", () => {
		expect(isParamVisible(axis, { values: { spin: 0 } })).toBe(false);
		expect(isParamVisible(axis, { values: { spin: 20 } })).toBe(true);
	});

	it("ignores the live value of a linked param", () => {
		const volumeLinks = { spin: { min: 0, max: 70 } };
		expect(isParamVisible(axis, { values: { spin: 0 }, volumeLinks })).toBe(
			true,
		);
	});

	it("hides when the link range never satisfies it", () => {
		const volumeLinks = { spin: { min: 0, max: 0 } };
		expect(isParamVisible(axis, { values: { spin: 30 }, volumeLinks })).toBe(
			false,
		);
	});
});
