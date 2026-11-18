import { describe, expect, it } from "bun:test";
import { plainCopy } from "./plain-copy.svelte";
import { liveState } from "./testing/live-state.svelte";

describe("plainCopy", () => {
	it("copies nested arrays and objects, so the copy doesn't follow the original", () => {
		const live = liveState({ clips: [{ id: "a", values: { amount: 0.5 } }] });
		const copy = plainCopy(live);
		live.clips[0].values.amount = 0.9;
		live.clips.push({ id: "b", values: { amount: 0 } });
		expect(copy).toEqual({ clips: [{ id: "a", values: { amount: 0.5 } }] });
	});

	it("keeps every kind of plain value", () => {
		const live = liveState({
			n: 1,
			s: "x",
			on: true,
			none: null,
			gone: undefined,
			keys: { amount: [{ t: 0, v: 1, ease: "smooth" }] },
		});
		expect(plainCopy(live)).toEqual({
			n: 1,
			s: "x",
			on: true,
			none: null,
			gone: undefined,
			keys: { amount: [{ t: 0, v: 1, ease: "smooth" }] },
		});
	});

	it("hands anything that isn't plain data to the snapshot", () => {
		const when = new Date(0);
		const copy = plainCopy({ when });
		expect(copy.when).toEqual(when);
		expect(copy.when).not.toBe(when);
	});
});
