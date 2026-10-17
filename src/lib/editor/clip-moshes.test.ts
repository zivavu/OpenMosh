import { describe, expect, it } from "bun:test";
import { ClipMoshes } from "./clip-moshes.svelte";

describe("ClipMoshes", () => {
	it("records an undo step before every roll and arrow", () => {
		let seed = 0;
		let steps = 0;
		const clip = { id: "c" };
		const moshes = new ClipMoshes({
			clips: () => [clip],
			snapshot: () => ({ effects: [], seed, label: "mosh" }),
			roll: () => void seed++,
			restore: (_, snap) => (seed = snap.seed ?? 0),
			beforeChange: () => steps++,
		});
		moshes.roll(["c"]);
		moshes.back("c");
		moshes.forward("c");
		expect(steps).toBe(3);
		expect(seed).toBe(1);
		// Nothing to step back to: no change, so no step.
		moshes.back("c");
		moshes.back("c");
		expect(steps).toBe(4);
	});
});
