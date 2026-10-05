import { describe, expect, it } from "bun:test";
import {
	KEY_RANGE_MAX,
	MAX_COLOR_KEYS,
	keyUniforms,
	oklab,
	parseKeys,
	serializeKeys,
} from "./mask-keys";

const key = { color: "#00ff00", x: 0.2, y: 0.7, range: 0.1, softness: 0.04 };

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

describe("oklab", () => {
	it("puts white at L 1 and black at L 0, both without chroma", () => {
		const [wl, wa, wb] = oklab(1, 1, 1);
		expect(wl).toBeCloseTo(1, 3);
		expect(Math.hypot(wa, wb)).toBeLessThan(1e-3);
		expect(oklab(0, 0, 0).every((c) => Math.abs(c) < 1e-6)).toBe(true);
	});

	it("matches the reference value for pure red", () => {
		const [l, a, b] = oklab(1, 0, 0);
		expect(l).toBeCloseTo(0.628, 3);
		expect(a).toBeCloseTo(0.2249, 3);
		expect(b).toBeCloseTo(0.1258, 3);
	});
});

describe("keyUniforms", () => {
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
