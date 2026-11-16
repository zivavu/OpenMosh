import { describe, expect, it } from "bun:test";
import { createEffectInstance, getDefinition } from "../effects";
import { setParamKey } from "../effects/param-keys";
import { groupParam } from "../effects/param-groups";
import { markCopied } from "../editor/copy-stamp";
import { DEFAULT_MEDIA_STYLE, type MediaLane } from "../media";
import { toggleLaneKey } from "../media/lane-keys";
import {
	chainKeysAt,
	copiedKeys,
	copyKeys,
	laneKeysAt,
	pasteIntoChain,
	pasteIntoLane,
	rowKeysAt,
} from "./key-clipboard";
import { chainKeyRows } from "./key-rows";

function posterize(id: string) {
	return {
		...createEffectInstance(getDefinition("posterize")!),
		instanceId: id,
		enabled: true,
	};
}

/** Posterize keyed on Levels at 0s (4) and 2s (12), smooth from the first. */
function keyed(id = "a") {
	const e = setParamKey(
		setParamKey(posterize(id), "levels", 0, 4),
		"levels",
		2,
		12,
	);
	e.keys!.levels[0].ease = "smooth";
	return e;
}

function lane(): MediaLane {
	return {
		id: "l",
		name: "Media 1",
		enabled: true,
		z: 0,
		sourceId: "src",
		style: { ...DEFAULT_MEDIA_STYLE },
		clips: [],
	};
}

describe("copying keys", () => {
	it("takes a chain's keys at the picked moments, in timeline seconds", () => {
		const copied = chainKeysAt([keyed()], [2], 10);
		expect(copied).toEqual([
			{
				target: { kind: "fx", defId: "posterize", nth: 0, param: "levels" },
				t: 12,
				v: 12,
			},
		]);
	});

	it("counts the clipboard from its first key, and lets a later copy win", () => {
		copyKeys(chainKeysAt([keyed()], [0, 2], 10));
		expect(copiedKeys()!.map((k) => k.t)).toEqual([0, 2]);
		markCopied();
		expect(copiedKeys()).toBeNull();
	});

	it("takes a row's picked keys", () => {
		const rows = chainKeyRows({ start: 10, end: 14, effects: [keyed()] });
		expect(rowKeysAt(rows, [{ row: rows[0].id, t: 0 }])).toEqual([
			{
				target: { kind: "fx", defId: "posterize", nth: 0, param: "levels" },
				t: 10,
				v: 4,
				ease: "smooth",
			},
		]);
	});

	it("takes a group's curve once, however many settings follow it", () => {
		const started = groupParam(
			[posterize("a"), posterize("b")],
			0,
			"levels",
			null,
			0,
		);
		const group = started[0].keyLinks!.levels.group;
		const both = groupParam(started, 1, "levels", group, 0);
		expect(chainKeysAt(both, [0], 0)).toEqual([
			{ target: { kind: "fxgroup", group }, t: 0, v: expect.any(Number) },
		]);
	});
});

describe("pasting keys", () => {
	it("lands the keys at the playhead on the same kind of effect, ease and all", () => {
		const keys = chainKeysAt([keyed()], [0, 2], 0);
		const { effects, landed } = pasteIntoChain([posterize("b")], keys, 1);
		expect(landed).toBe(2);
		expect(effects[0].keys!.levels).toEqual([
			{ t: 1, v: 4, ease: "smooth" },
			{ t: 3, v: 12 },
		]);
	});

	it("finds the second copy of an effect by its place in the chain", () => {
		copyKeys(chainKeysAt([posterize("x"), keyed("y")], [2], 0));
		const { effects } = pasteIntoChain(
			[posterize("p"), posterize("q")],
			copiedKeys()!,
			0,
		);
		expect(effects[0].keys).toBeUndefined();
		expect(effects[1].keys!.levels).toEqual([{ t: 0, v: 12 }]);
	});

	it("leaves out keys whose effect isn't in the chain", () => {
		const keys = chainKeysAt([keyed()], [0], 0);
		expect(pasteIntoChain([], keys, 0).landed).toBe(0);
	});

	it("lands a layer's placement keys at the playhead", () => {
		const from = toggleLaneKey(lane(), "x", 3, false);
		const keys = laneKeysAt(from, [3]);
		copyKeys(keys);
		const { lane: to, landed } = pasteIntoLane(lane(), copiedKeys()!, 7);
		expect(landed).toBe(1);
		expect(to.keys!.x).toEqual([{ t: 7, v: DEFAULT_MEDIA_STYLE.x }]);
	});
});
