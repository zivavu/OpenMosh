import { describe, expect, test } from "bun:test";
import type { EffectInstance } from "../effects";
import type { ChainClip } from "./chain-clip";
import {
	fanOutChainEdit,
	fanOutClipEdit,
	fanOutEdit,
	sameLiveChain,
} from "./chain-fanout";

let nextId = 0;
function fx(
	defId: string,
	enabled: boolean,
	values: Record<string, number | string> = {},
): EffectInstance {
	return {
		instanceId: `i${nextId++}`,
		defId,
		enabled,
		locked: false,
		expanded: false,
		values,
	};
}

function edit(
	chain: EffectInstance[],
	change: (c: EffectInstance[]) => void,
): EffectInstance[] {
	const next = structuredClone(chain);
	change(next);
	return next;
}

function clip(effects: EffectInstance[], extra: Partial<ChainClip> = {}) {
	return { id: "c", start: 0, end: 1, label: "x", effects, ...extra };
}

describe("sameLiveChain", () => {
	test("compares only what is switched on, in order", () => {
		const a = [fx("pixelate", true), fx("solarize", false)];
		const b = [fx("posterize", false), fx("pixelate", true)];
		expect(sameLiveChain([a, b])).toBe(true);
		expect(sameLiveChain([a, [fx("solarize", true)]])).toBe(false);
	});

	test("order counts", () => {
		const a = [fx("pixelate", true), fx("solarize", true)];
		const b = [fx("solarize", true), fx("pixelate", true)];
		expect(sameLiveChain([a, b])).toBe(false);
	});
});

describe("fanOutChainEdit", () => {
	test("carries only the changed param, keeping the target's others", () => {
		const before = [fx("pixelate", true, { size: 4, mix: 1 })];
		const after = edit(before, (c) => (c[0].values.size = 9));
		const target = [fx("pixelate", true, { size: 2, mix: 0.5 })];
		const [out] = fanOutChainEdit(before, after, target);
		expect(out.values).toEqual({ size: 9, mix: 0.5 });
		expect(out.instanceId).toBe(target[0].instanceId);
	});

	test("carries a toggle and a lock", () => {
		const before = [fx("pixelate", true), fx("solarize", false)];
		const after = edit(before, (c) => {
			c[1].enabled = true;
			c[0].locked = true;
		});
		const target = [fx("pixelate", true), fx("solarize", false)];
		const out = fanOutChainEdit(before, after, target);
		expect(out.map((e) => [e.enabled, e.locked])).toEqual([
			[true, true],
			[true, false],
		]);
	});

	test("takes the edited chain's order", () => {
		const before = [fx("pixelate", true), fx("solarize", true)];
		const after = edit(before, (c) => c.reverse());
		const target = [fx("pixelate", true), fx("solarize", true)];
		const out = fanOutChainEdit(before, after, target);
		expect(out.map((e) => e.defId)).toEqual(["solarize", "pixelate"]);
	});

	test("adds a copy of a new effect and drops a removed one", () => {
		const before = [fx("pixelate", true), fx("solarize", false)];
		const after = [before[0], fx("posterize", true, { levels: 3 })];
		const target = [fx("pixelate", true), fx("solarize", false)];
		const out = fanOutChainEdit(before, after, target);
		expect(out.map((e) => e.defId)).toEqual(["pixelate", "posterize"]);
		expect(out[1].values).toEqual({ levels: 3 });
		expect(out[1].instanceId).not.toBe(after[1].instanceId);
	});

	test("matches a duplicate to the target's same copy", () => {
		const before = [fx("pixelate", true, { size: 1 }), fx("pixelate", true)];
		const after = edit(before, (c) => (c[1].values.size = 7));
		const target = [
			fx("pixelate", true, { size: 2 }),
			fx("pixelate", true, { size: 3 }),
		];
		const out = fanOutChainEdit(before, after, target);
		expect(out.map((e) => e.values.size)).toEqual([2, 7]);
	});

	test("keeps effects the edited chain never had", () => {
		const before = [fx("pixelate", true)];
		const after = edit(before, (c) => (c[0].values.size = 5));
		const target = [fx("solarize", false), fx("pixelate", true)];
		const out = fanOutChainEdit(before, after, target);
		expect(out.map((e) => e.defId)).toEqual(["pixelate", "solarize"]);
	});

	test("sets and clears volume links", () => {
		const link = { min: 0, max: 1 };
		const before = [fx("pixelate", true)];
		const linked = edit(before, (c) => (c[0].volumeLinks = { size: link }));
		const target = [fx("pixelate", true)];
		const on = fanOutChainEdit(before, linked, target);
		expect(on[0].volumeLinks).toEqual({ size: link });
		const off = fanOutChainEdit(linked, before, on);
		expect(off[0].volumeLinks).toBeUndefined();
	});
});

describe("fanOutClipEdit", () => {
	test("copies a relabel, as a preset apply makes", () => {
		const effects = [fx("pixelate", true)];
		const before = clip(effects, { label: "mosh" });
		const after = clip(effects, { label: "Warm", presetName: "Warm" });
		const out = fanOutClipEdit(before, after, clip([fx("pixelate", true)]));
		expect(out.label).toBe("Warm");
		expect(out.presetName).toBe("Warm");
	});

	test("re-derives a hand-built label from the new chain", () => {
		const before = [fx("pixelate", true), fx("solarize", false)];
		const after = edit(before, (c) => (c[1].enabled = true));
		const target = clip([fx("pixelate", true), fx("solarize", false)], {
			label: "pixelate",
		});
		const out = fanOutClipEdit(clip(before), clip(after), target);
		expect(out.label).toBe("pixelate +1");
	});

	test("marks another preset edited without renaming it", () => {
		const before = [fx("pixelate", true)];
		const after = edit(before, (c) => (c[0].values.size = 2));
		const target = clip([fx("pixelate", true)], {
			label: "Cold",
			presetName: "Cold",
		});
		const out = fanOutClipEdit(
			clip(before, { label: "Warm", presetName: "Warm" }),
			clip(after, { label: "Warm", presetName: "Warm", modified: true }),
			target,
		);
		expect([out.label, out.presetName, out.modified]).toEqual([
			"Cold",
			"Cold",
			true,
		]);
	});
});

describe("fanOutEdit", () => {
	test("edits nothing when the clips run different effects", () => {
		const before = clip([fx("pixelate", true)]);
		const after = clip(edit(before.effects, (c) => (c[0].values.size = 3)));
		const other = clip([fx("solarize", true)]);
		expect(fanOutEdit(before, after, [other])).toEqual([]);
	});

	test("edits nothing when the chain did not change", () => {
		const before = clip([fx("pixelate", true)]);
		const other = clip([fx("pixelate", true)]);
		expect(fanOutEdit(before, { ...before }, [other])).toEqual([]);
	});
});
