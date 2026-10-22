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

	it("keeps a tweak made to a mosh when the arrows step away and back", () => {
		let state = { seed: 0, tweak: "" };
		const moshes = new ClipMoshes({
			clips: () => [{ id: "c" }],
			snapshot: () => ({ effects: [], seed: state.seed, label: state.tweak }),
			roll: () => (state = { seed: state.seed + 1, tweak: "" }),
			restore: (_, snap) => (state = { seed: snap.seed!, tweak: snap.label }),
		});
		moshes.roll(["c"]);
		state.tweak = "mine";
		moshes.back("c");
		moshes.forward("c");
		expect(state).toEqual({ seed: 1, tweak: "mine" });
	});

	it("keeps a tweak when the next mosh comes from a roll, not an arrow", () => {
		let state = { seed: 0, tweak: "" };
		const moshes = new ClipMoshes({
			clips: () => [{ id: "c" }],
			snapshot: () => ({ effects: [], seed: state.seed, label: state.tweak }),
			roll: () => (state = { seed: state.seed + 1, tweak: "" }),
			restore: (_, snap) => (state = { seed: snap.seed!, tweak: snap.label }),
		});
		moshes.forward("c");
		state.tweak = "mine";
		moshes.roll(["c"]);
		moshes.back("c");
		expect(state).toEqual({ seed: 1, tweak: "mine" });
	});
});
