import { describe, expect, it } from "bun:test";
import { createEffectInstance, getDefinition, loadInitialEffects } from ".";
import { splitChainClipAt, type ChainClip } from "../editor/chain-clip";
import { fanOutChainEdit } from "../editor/chain-fanout";
import { generateMosh } from "../editor/mosh";
import {
	chainAtKeyTime,
	chainKeyTimes,
	clearChainKeys,
	clearParamKeys,
	hydrateParamKeys,
	moveChainKeys,
	paramValueAt,
	removeParamKey,
	repeatChainKeys,
	setChainEaseAt,
	setParamKey,
	simplifyChainKeys,
	removeChainKeysAt,
} from "./param-keys";
import type { EffectInstance } from "./types";

function posterize(): EffectInstance {
	return {
		...createEffectInstance(getDefinition("posterize")!),
		enabled: true,
	};
}

/** Levels 4 at 0s rising to 12 at 4s. */
function ramp(): EffectInstance {
	return setParamKey(setParamKey(posterize(), "levels", 0, 4), "levels", 4, 12);
}

describe("keying a slider", () => {
	it("samples between keys, on the slider's step", () => {
		const e = ramp();
		expect(paramValueAt(e, "levels", 2)).toBe(8);
		expect(paramValueAt(e, "levels", 1.1)).toBe(6);
		expect(paramValueAt(e, "levels", null)).toBe(12);
	});

	it("holds the value it had when the last key goes", () => {
		let e = setParamKey(posterize(), "levels", 1, 5);
		e = removeParamKey(e, "levels", 1.01);
		expect(e.keys).toBeUndefined();
		expect(e.values.levels).toBe(5);
	});

	it("stops animating at the value shown under the playhead", () => {
		const e = clearParamKeys(ramp(), "levels", 1);
		expect(e.keys).toBeUndefined();
		expect(e.values.levels).toBe(6);
	});
});

describe("chainAtKeyTime", () => {
	it("hands back a chain without keys untouched", () => {
		const chain = [posterize()];
		expect(chainAtKeyTime(chain, 1)).toBe(chain);
	});

	it("samples into copies that keep their instance ids", () => {
		const chain = [ramp()];
		const out = chainAtKeyTime(chain, 2);
		expect(out[0].values.levels).toBe(8);
		expect(out[0].instanceId).toBe(chain[0].instanceId);
		expect(chain[0].values.levels).toBe(12);
	});
});

describe("chain key edits", () => {
	it("merges keys at one moment and moves them together", () => {
		const a = ramp();
		const b = { ...setParamKey(posterize(), "levels", 4, 2) };
		expect(chainKeyTimes([a, b])).toEqual([0, 4]);
		const moved = moveChainKeys([a, b], [4], -1);
		expect(chainKeyTimes(moved)).toEqual([0, 3]);
	});

	it("deletes, clears and simplifies keys across the chain", () => {
		const both = [ramp(), setParamKey(posterize(), "levels", 4, 2)];
		expect(chainKeyTimes(removeChainKeysAt(both, [0, 4]))).toEqual([]);
		const [cleared] = clearChainKeys([ramp()]);
		expect(cleared.keys).toBeUndefined();
		expect(cleared.values.levels).toBe(4);
		let dense = posterize();
		for (let i = 0; i <= 40; i++)
			dense = setParamKey(dense, "levels", i / 10, 4 + i / 5);
		expect(simplifyChainKeys([dense])[0].keys?.levels).toHaveLength(2);
	});

	it("sets an ease on every key at a moment", () => {
		const [e] = setChainEaseAt([ramp()], [0], "hold");
		expect(paramValueAt(e, "levels", 3.9)).toBe(4);
	});
});

describe("hydrateParamKeys", () => {
	it("keeps only slider params, held to their range", () => {
		const keys = hydrateParamKeys("posterize", {
			levels: [{ t: 0, v: 999 }],
			nope: [{ t: 0, v: 1 }],
		});
		expect(keys).toEqual({ levels: [{ t: 0, v: 20 }] });
		expect(hydrateParamKeys("posterize", "junk")).toBeUndefined();
	});
});

describe("on a clip", () => {
	const clip: ChainClip = {
		id: "c",
		start: 10,
		end: 14,
		label: "x",
		effects: [ramp()],
	};

	it("a split gives the right half keys from its own start", () => {
		const lane = splitChainClipAt({ clips: [clip] }, 12, () => "n");
		const [left, right] = lane.clips;
		expect(paramValueAt(left.effects[0], "levels", 2)).toBe(8);
		expect(paramValueAt(right.effects[0], "levels", 0)).toBe(8);
		expect(paramValueAt(right.effects[0], "levels", 2)).toBe(12);
	});

	it("a mosh drops keys from what it rolls, and Lock keeps them", () => {
		const effects = loadInitialEffects();
		const rolled = effects.findIndex((e) => e.defId === "posterize");
		effects[rolled] = { ...ramp(), instanceId: effects[rolled].instanceId };
		const lockedIndex = effects.findIndex((e) => e.defId === "pixelate");
		effects[lockedIndex] = {
			...setParamKey(effects[lockedIndex], "size", 0, 5),
			locked: true,
		};
		generateMosh(effects, {
			moshMin: 1,
			moshMax: 3,
			randomizeOrder: false,
			moshAudioLink: false,
			moshAudioLinkStrength: 0,
			hasAudio: false,
		});
		expect(effects.find((e) => e.defId === "posterize")!.keys).toBeUndefined();
		expect(effects.find((e) => e.defId === "pixelate")!.keys).toBeDefined();
	});

	it("keying one selected clip keys the others from their own start", () => {
		const before = [posterize()];
		const after = [setParamKey(before[0], "levels", 1, 9)];
		const target = [{ ...posterize(), instanceId: "other" }];
		const [out] = fanOutChainEdit(before, after, target);
		expect(out.keys?.levels).toEqual([{ t: 1, v: 9 }]);
	});
});

describe("repeatChainKeys", () => {
	it("loops a run that ends where it began", () => {
		let e = setParamKey(posterize(), "levels", 0, 4);
		e = setParamKey(e, "levels", 1, 12);
		e = setParamKey(e, "levels", 2, 4);
		const [out] = repeatChainKeys([e], 6);
		expect(out.keys?.levels.map((k) => k.t)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	it("jumps back to the start of a one-way ramp", () => {
		const [out] = repeatChainKeys([ramp()], 8);
		expect(paramValueAt(out, "levels", 4)).toBe(12);
		expect(paramValueAt(out, "levels", 4.1)).toBeLessThan(6);
		expect(paramValueAt(out, "levels", 8)).toBe(12);
	});
});
