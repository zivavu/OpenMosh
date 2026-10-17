import { describe, expect, it } from "bun:test";
import { loadInitialEffects, type EffectInstance } from "../effects";
import { createMoshSession } from "./mosh-session";

function session(start: EffectInstance[]) {
	let effects = start;
	const s = createMoshSession({
		getEffects: () => effects,
		setEffects: (v) => (effects = v),
		getMoshOptions: () => ({}) as never,
		cancelBurst: () => {},
		endBurst: () => {},
	});
	return {
		s,
		get effects() {
			return effects;
		},
		edit(i: number) {
			effects = effects.map((e, j) => (j === i ? { ...e, enabled: true } : e));
			s.pushEdit(effects);
		},
	};
}

const enabled = (effects: EffectInstance[]) =>
	effects.flatMap((e, i) => (e.enabled ? [i] : []));

describe("createMoshSession", () => {
	it("undoes back to a restored chain, not the startup defaults", () => {
		const restored = loadInitialEffects().map((e, i) => ({
			...e,
			enabled: i < 2,
		}));
		const t = session(restored);
		t.edit(2);
		t.s.undoEdit();
		expect(enabled(t.effects)).toEqual([0, 1]);
		expect(t.s.touched).toBe(false);
	});
});
