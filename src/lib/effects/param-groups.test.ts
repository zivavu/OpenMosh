import { describe, expect, it } from "bun:test";
import { createEffectInstance, getDefinition } from ".";
import { generateMosh } from "../editor/mosh";
import { chainKeyRows, withChainTracks } from "../timeline/key-rows";
import { hydrateEffects } from "./hydrate";
import {
	chainGroupNames,
	groupParam,
	keyGroupedValue,
	setParamGroupRange,
	toggleGroupedKey,
	ungroupParam,
} from "./param-groups";
import { chainAtKeyTime, paramValueAt, setParamKey } from "./param-keys";
import type { EffectInstance } from "./types";

function fx(defId: string, id: string): EffectInstance {
	return {
		...createEffectInstance(getDefinition(defId)!),
		instanceId: id,
		enabled: true,
	};
}

/** Posterize levels ramping 4 → 12 over 2s, and a pixelate not animated. */
function chain(): EffectInstance[] {
	const p = setParamKey(
		setParamKey(fx("posterize", "p"), "levels", 0, 4),
		"levels",
		2,
		12,
	);
	return [p, fx("pixelate", "x")];
}

describe("groups", () => {
	it("a new group keeps the setting's motion as its curve", () => {
		const out = groupParam(chain(), 0, "levels", null, 0);
		const link = out[0].keyLinks!.levels;
		expect(link).toMatchObject({ group: "A", min: 4, max: 12 });
		expect(link.keys.map((k) => k.v)).toEqual([0, 1]);
		expect(out[0].keys).toBeUndefined();
		expect(paramValueAt(out[0], "levels", 1)).toBe(8);
	});

	it("a second setting follows the curve in its own range, inverted if asked", () => {
		let out = groupParam(chain(), 0, "levels", null, 0);
		out = groupParam(out, 1, "size", "A", 0);
		out = setParamGroupRange(out, 1, "size", {
			min: 10,
			max: 50,
			inverted: true,
		});
		expect(chainGroupNames(out)).toEqual(["A"]);
		const at = chainAtKeyTime(out, 0.5);
		expect(at[0].values.levels).toBe(6);
		expect(at[1].values.size).toBe(40);
	});

	it("moving one member's slider keys the curve for all of them", () => {
		let out = groupParam(chain(), 0, "levels", null, 0);
		out = groupParam(out, 1, "size", "A", 0);
		out = keyGroupedValue(out, 0, "levels", 1, 12);
		expect(out[1].keyLinks!.size.keys).toEqual(out[0].keyLinks!.levels.keys);
		expect(paramValueAt(out[0], "levels", 1)).toBe(12);
	});

	it("leaving keeps the motion as keys of its own", () => {
		let out = groupParam(chain(), 0, "levels", null, 0);
		out = ungroupParam(out, 0, "levels");
		expect(out[0].keyLinks).toBeUndefined();
		expect(out[0].keys?.levels.map((k) => k.v)).toEqual([4, 12]);
	});

	it("taking the curve's last key away ends the group at the value shown", () => {
		let out = groupParam(chain(), 0, "levels", null, 0);
		out = toggleGroupedKey(out, 0, "levels", 0, false);
		out = toggleGroupedKey(out, 0, "levels", 2, false);
		expect(out[0].keyLinks).toBeUndefined();
		expect(out[0].values.levels).toBe(12);
	});

	it("shows as one row, whose edits reach every member", () => {
		let out = groupParam(chain(), 0, "levels", null, 0);
		out = groupParam(out, 1, "size", "A", 0);
		const rows = chainKeyRows({ start: 0, end: 2, effects: out });
		expect(rows.map((r) => r.label)).toEqual(["Group A · 2 settings"]);
		const next = withChainTracks(
			out,
			new Map([[rows[0].id, [{ t: 1, v: 0.5 }]]]),
		);
		expect(next[1].keyLinks!.size.keys).toEqual([{ t: 1, v: 0.5 }]);
	});

	it("survives a save and is dropped by a mosh like keys are", () => {
		const out = groupParam(chain(), 0, "levels", null, 0);
		const [read] = hydrateEffects(JSON.parse(JSON.stringify(out)));
		expect(read.keyLinks).toEqual(out[0].keyLinks);
		const rolled = structuredClone(out);
		generateMosh(rolled, {
			moshMin: 1,
			moshMax: 1,
			randomizeOrder: false,
			moshAudioLink: false,
			moshAudioLinkStrength: 0,
			hasAudio: false,
		});
		expect(rolled[0].keyLinks).toBeUndefined();
	});
});
