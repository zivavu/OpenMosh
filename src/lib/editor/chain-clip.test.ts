import { describe, expect, it } from "bun:test";
import type { EffectInstance } from "../effects";
import {
	resizeBoundary,
	resizeClipsIn,
	type SourceAnchor,
} from "../timeline/clips";
import { chainClipAnchor, type ChainClip } from "./chain-clip";

function keyed(id: string, start: number, end: number, times: number[]) {
	const effect = {
		instanceId: `${id}-fx`,
		defId: "pixelate",
		enabled: true,
		locked: false,
		expanded: false,
		values: {},
		keys: { amount: times.map((t) => ({ t, v: t })) },
	} as unknown as EffectInstance;
	return { id, start, end, label: "clean", effects: [effect] } as ChainClip;
}

const keyTimes = (c: ChainClip) =>
	c.effects[0].keys!.amount.map((k) => k.t + c.start);

describe("chainClipAnchor", () => {
	const lanes = () => [{ clips: [keyed("a", 2, 10, [1, 4])] }];

	it("holds keys in place when the start trims in", () => {
		const [lane] = resizeClipsIn(
			lanes(),
			["a"],
			"start",
			2,
			60,
			chainClipAnchor(),
		);
		expect(lane.clips[0].start).toBe(4);
		expect(keyTimes(lane.clips[0])).toEqual([3, 6]);
	});

	it("brings a hidden key back when the start comes out again", () => {
		const anchor = chainClipAnchor<ChainClip>();
		const trimmed = resizeClipsIn(lanes(), ["a"], "start", 2, 60, anchor);
		const [lane] = resizeClipsIn(trimmed, ["a"], "start", -2, 60, anchor);
		expect(lane.clips[0].effects[0].keys!.amount.map((k) => k.t)).toEqual([
			1, 4,
		]);
	});

	it("moves a timed source's in-point along with the keys", () => {
		type Shot = ChainClip & { sourceStart: number };
		const media: SourceAnchor<Shot> = {
			slack: (c) => c.sourceStart,
			move: (c, step) => ({ ...c, sourceStart: c.sourceStart + step }),
		};
		const shot: Shot = { ...keyed("a", 2, 10, [1]), sourceStart: 1 };
		const [lane] = resizeClipsIn(
			[{ clips: [shot] }],
			["a"],
			"start",
			-5,
			60,
			chainClipAnchor(media),
		);
		expect(lane.clips[0]).toMatchObject({ start: 1, sourceStart: 0 });
		expect(keyTimes(lane.clips[0])).toEqual([3]);
	});

	it("holds the right clip's keys across a shared edge", () => {
		const lane = { clips: [keyed("l", 0, 4, [1]), keyed("r", 4, 8, [1])] };
		const next = resizeBoundary(lane, "l", "r", 5, chainClipAnchor());
		const [left, right] = next.clips;
		expect(keyTimes(left)).toEqual([1]);
		expect(keyTimes(right)).toEqual([5]);
	});
});
