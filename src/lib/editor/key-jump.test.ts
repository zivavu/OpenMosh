import { describe, expect, it } from "bun:test";
import { createEffectInstance, getDefinition } from "../effects";
import { setParamKey } from "../effects/param-keys";
import { adjacentMoment, keyMoments } from "./key-jump";

function clip(start: number, keyAt: number[]) {
	let e = createEffectInstance(getDefinition("posterize")!);
	for (const t of keyAt) e = setParamKey(e, "levels", t, 4);
	return { start, end: start + 4, effects: [e] };
}

describe("keyMoments", () => {
	it("puts each clip's keys on the timeline, leaving out those its trim hides", () => {
		expect(keyMoments([clip(10, [-1, 0, 2]), clip(1, [3])], [])).toEqual([
			4, 10, 12,
		]);
	});

	it("takes a layer's placement keys as they are", () => {
		expect(keyMoments([], [{ keys: { x: [{ t: 5, v: 0 }] } }])).toEqual([5]);
	});
});

describe("adjacentMoment", () => {
	const times = [1, 4, 9];

	it("steps to the next and the previous key, past one under the playhead", () => {
		expect(adjacentMoment(times, 4, 1)).toBe(9);
		expect(adjacentMoment(times, 4, -1)).toBe(1);
	});

	it("finds nothing past the ends", () => {
		expect(adjacentMoment(times, 9, 1)).toBeNull();
		expect(adjacentMoment(times, 0, -1)).toBeNull();
	});
});
