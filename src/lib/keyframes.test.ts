import { describe, expect, it } from "bun:test";
import {
	eased,
	isKeyEase,
	KEY_EASES,
	keyNear,
	normalizeTrack,
	putKeyframe,
	sampleNumbers,
	type Keyframe,
} from "./keyframes";

const track: Keyframe<number>[] = [
	{ t: 0, v: 0 },
	{ t: 2, v: 10 },
];

describe("sampleNumbers", () => {
	it("holds the ends and runs linear between keys", () => {
		expect(sampleNumbers(track, -1)).toBe(0);
		expect(sampleNumbers(track, 1)).toBe(5);
		expect(sampleNumbers(track, 3)).toBe(10);
		expect(sampleNumbers([], 1)).toBeNull();
	});

	it("eases a smooth key and jumps after a hold key", () => {
		const smooth = [{ ...track[0], ease: "smooth" as const }, track[1]];
		expect(sampleNumbers(smooth, 0.5)).toBeLessThan(2.5);
		expect(sampleNumbers(smooth, 1)).toBe(5);
		const hold = [{ ...track[0], ease: "hold" as const }, track[1]];
		expect(sampleNumbers(hold, 1.99)).toBe(0);
		expect(sampleNumbers(hold, 2)).toBe(10);
	});
});

describe("putKeyframe", () => {
	it("keeps the ease of the key it replaces", () => {
		const keys = putKeyframe([{ t: 1, v: 1, ease: "hold" }], 1, 5);
		expect(keys).toEqual([{ t: 1, v: 5, ease: "hold" }]);
	});
});

describe("keyNear", () => {
	it("finds the closest key inside the window", () => {
		expect(keyNear(track, 1.99)?.t).toBe(2);
		expect(keyNear(track, 1)).toBeNull();
	});
});

describe("normalizeTrack", () => {
	it("sorts, drops broken entries and keeps eases", () => {
		const raw = [{ t: 2, v: 1 }, { t: "x" }, { t: 1, v: 0, ease: "smooth" }];
		expect(normalizeTrack(raw, Number)).toEqual([
			{ t: 1, v: 0, ease: "smooth" },
			{ t: 2, v: 1 },
		]);
	});

	it("keeps keys before 0, which a clip's start hides", () => {
		const raw = [
			{ t: -2, v: 0 },
			{ t: -1, v: 1, ease: "smooth" },
			{ t: 1, v: 2 },
		];
		expect(normalizeTrack(raw, Number)).toEqual([
			{ t: -2, v: 0 },
			{ t: -1, v: 1, ease: "smooth" },
			{ t: 1, v: 2 },
		]);
	});

	it("keeps the later of two keys at one moment", () => {
		const raw = [
			{ t: 1, v: 0 },
			{ t: 1, v: 5 },
		];
		expect(normalizeTrack(raw, Number)).toEqual([{ t: 1, v: 5 }]);
	});

	it("reads no more than its cap from a crafted save", () => {
		const raw = Array.from({ length: 5000 }, (_, t) => ({ t, v: t }));
		expect(normalizeTrack(raw, Number, 100)).toHaveLength(100);
	});
});

describe("eased", () => {
	it("starts and ends every curve on its keys", () => {
		for (const ease of KEY_EASES.filter((e) => e !== "hold")) {
			expect(eased(ease, 0)).toBeCloseTo(0);
			expect(eased(ease, 1)).toBeCloseTo(1);
		}
	});

	it("speeds up into the next key with in, and settles with out", () => {
		expect(eased("in", 0.5)).toBeLessThan(0.5);
		expect(eased("out", 0.5)).toBeGreaterThan(0.5);
	});

	it("runs past the next key's value on an overshoot, and never on a bounce", () => {
		const along = Array.from({ length: 101 }, (_, i) => i / 100);
		expect(
			Math.max(...along.map((k) => eased("overshoot", k))),
		).toBeGreaterThan(1);
		expect(
			Math.max(...along.map((k) => eased("bounce", k))),
		).toBeLessThanOrEqual(1);
	});

	it("reads every ease back from a save, and drops one it doesn't know", () => {
		for (const ease of KEY_EASES) expect(isKeyEase(ease)).toBe(true);
		expect(isKeyEase("elastic")).toBe(false);
	});
});
