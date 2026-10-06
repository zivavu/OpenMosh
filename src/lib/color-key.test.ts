import { describe, expect, it } from "bun:test";
import { keysMatch, oklab, type KeySpec } from "./color-key";

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

describe("keysMatch", () => {
	const green: KeySpec = {
		r: 0,
		g: 1,
		b: 0,
		x: 0.5,
		y: 0.5,
		range: 0.1,
		softness: 0.04,
		touching: false,
		on: true,
	};

	it("selects the key's colour fully and leaves a far one alone", () => {
		expect(keysMatch([green], 0, 1, 0)).toBe(1);
		expect(keysMatch([green], 1, 0, 0)).toBe(0);
	});

	it("fades only past the range", () => {
		const m = keysMatch([{ ...green, range: 0, softness: 0.3 }], 0.1, 0.9, 0.1);
		expect(m).toBeGreaterThan(0);
		expect(m).toBeLessThan(1);
	});

	it("takes the strongest of several colours", () => {
		const red = { ...green, r: 1, g: 0 };
		expect(keysMatch([green, red], 1, 0, 0)).toBe(1);
	});

	it("skips a colour that's off", () => {
		expect(keysMatch([{ ...green, on: false }], 0, 1, 0)).toBe(0);
	});

	it("takes a touching colour only inside its fill", () => {
		const local = [{ ...green, touching: true }];
		expect(keysMatch(local, 0, 1, 0, true)).toBe(1);
		expect(keysMatch(local, 0, 1, 0, false)).toBe(0);
	});
});
