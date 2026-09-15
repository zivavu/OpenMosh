import { describe, expect, it } from "bun:test";
import { findSnap, landedAt, type SnapPoint } from "./snap";

const none = new Set<string>();
const at = (time: number, ownerId: string | null = null): SnapPoint => ({
	time,
	ownerId,
});

describe("findSnap", () => {
	it("lands the nearest edge on the nearest target inside the threshold", () => {
		const hit = findSnap([1.04, 3], [at(1, "a"), at(2.8, "b")], 0.1, none);
		expect(hit?.at).toBe(1);
		expect(hit?.shift).toBeCloseTo(-0.04);
	});

	it("is null when nothing is close enough", () => {
		expect(findSnap([1.2], [at(1)], 0.1, none)).toBeNull();
	});

	it("skips targets owned by the thing being dragged", () => {
		const targets = [at(1, "self"), at(1.06, "other")];
		expect(findSnap([1], targets, 0.1, new Set(["self"]))?.at).toBe(1.06);
	});

	it("never skips ownerless targets", () => {
		expect(findSnap([0.02], [at(0)], 0.1, new Set(["x"]))?.at).toBe(0);
	});

	it("uses whichever edge of a group is closest", () => {
		const hit = findSnap([0, 2.03], [at(2, "a")], 0.1, none);
		expect(hit?.shift).toBeCloseTo(-0.03);
	});

	it("snaps to the beat grid when nothing on screen is closer", () => {
		const hit = findSnap([1.52], [], 0.1, none, 0.5);
		expect(hit?.at).toBe(1.5);
		expect(hit?.shift).toBeCloseTo(-0.02);
	});

	it("prefers an edge over a beat at the same distance", () => {
		const hit = findSnap([1.52], [at(1.54, "a")], 0.1, none, 0.5);
		expect(hit?.at).toBe(1.54);
		const nearer = findSnap([1.52], [at(1.56, "a")], 0.1, none, 0.5);
		expect(nearer?.at).toBe(1.5);
	});

	it("ignores the grid when beatSec is 0", () => {
		expect(findSnap([1.52], [], 0.1, none, 0)).toBeNull();
	});
});

describe("landedAt", () => {
	it("is true only when an edge sits on the time", () => {
		expect(landedAt([0, 2], 2)).toBe(true);
		expect(landedAt([0, 2.001], 2)).toBe(false);
	});
});
