import { describe, expect, it } from "bun:test";
import { KEY_RANGE_MAX, MAX_COLOR_KEYS } from "../color-key";
import { keyUniforms, parseKeys, serializeKeys } from "./mask-keys";

const key = {
	color: "#00ff00",
	x: 0.2,
	y: 0.7,
	range: 0.1,
	softness: 0.04,
	touching: false,
	on: true,
};

describe("parseKeys", () => {
	it("reads back what serializeKeys wrote", () => {
		expect(parseKeys(serializeKeys([key]))).toEqual([key]);
	});

	it("stores no keys as an empty string, the param's default", () => {
		expect(serializeKeys([])).toBe("");
		expect(parseKeys("")).toEqual([]);
	});

	it("drops what isn't a key and clamps what is", () => {
		const raw = JSON.stringify([
			{ color: "green" },
			{ ...key, color: "#ABCDEF", range: 9, x: -1 },
			null,
		]);
		expect(parseKeys(raw)).toEqual([
			{ ...key, color: "#abcdef", range: KEY_RANGE_MAX, x: 0 },
		]);
		expect(parseKeys("{not json")).toEqual([]);
		expect(parseKeys(42)).toEqual([]);
	});

	it("keeps no more keys than the shader holds", () => {
		const many = Array.from({ length: MAX_COLOR_KEYS + 3 }, () => key);
		expect(parseKeys(JSON.stringify(many))).toHaveLength(MAX_COLOR_KEYS);
	});
});

describe("keyUniforms", () => {
	it("keeps a colour that's off, marked off", () => {
		const raw = serializeKeys([key, { ...key, on: false }]);
		expect(parseKeys(raw)[1].on).toBe(false);
		expect([...keyUniforms(raw).on.slice(0, 2)]).toEqual([1, 0]);
	});

	it("reads a colour saved before the switch existed as on", () => {
		const { on: _, ...old } = key;
		expect(parseKeys(JSON.stringify([old]))[0].on).toBe(true);
	});

	it("marks touching keys and where they were picked", () => {
		const packed = keyUniforms(
			serializeKeys([key, { ...key, touching: true, x: 0.9, y: 0.1 }]),
		);
		expect(packed.anyTouching).toBe(true);
		expect([...packed.touch.slice(0, 2)]).toEqual([0, 1]);
		expect(packed.seeds[2]).toBeCloseTo(0.9);
		expect(packed.seeds[3]).toBeCloseTo(0.1);
	});

	it("packs each key's colour and tolerances in order", () => {
		const packed = keyUniforms(
			serializeKeys([key, { ...key, color: "#ffffff" }]),
		);
		expect(packed.count).toBe(2);
		expect(packed.labs[3]).toBeCloseTo(1, 3);
		expect(packed.tunes[0]).toBeCloseTo(0.1);
		expect(packed.tunes[1]).toBeCloseTo(0.04);
	});
});
