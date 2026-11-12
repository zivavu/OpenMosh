import { describe, expect, it } from "bun:test";
import { createEffectInstance, getDefinition } from "../effects";
import { setParamKey } from "../effects/param-keys";
import { DEFAULT_MEDIA_STYLE, type MediaLane } from "../media";
import { toggleLaneKey } from "../media/lane-keys";
import {
	chainKeyRows,
	dragKeys,
	laneKeyRows,
	pickRange,
	withChainTracks,
	withLaneTracks,
} from "./key-rows";

function posterize(id: string) {
	return {
		...createEffectInstance(getDefinition("posterize")!),
		instanceId: id,
		enabled: true,
	};
}

/** Two posterizes keyed on Levels, the clip at 10–14s. */
function clip() {
	const a = setParamKey(
		setParamKey(posterize("a"), "levels", 0, 4),
		"levels",
		2,
		12,
	);
	const b = setParamKey(posterize("b"), "levels", 1, 6);
	return { start: 10, end: 14, effects: [a, b] };
}

describe("chainKeyRows", () => {
	it("gives each keyed slider a row, numbering a second copy", () => {
		const rows = chainKeyRows(clip());
		expect(rows.map((r) => r.label)).toEqual([
			"Posterize · Levels",
			"Posterize 2 · Levels",
		]);
		expect(rows[0]).toMatchObject({
			offset: 10,
			from: 10,
			to: 14,
			min: 2,
			max: 20,
		});
		expect(rows[0].color).not.toBe(rows[1].color);
	});

	it("writes an edited row back, and an emptied one holds its first key", () => {
		const c = clip();
		const [row] = chainKeyRows(c);
		const out = withChainTracks(c.effects, new Map([[row.id, []]]));
		expect(out[0].keys).toBeUndefined();
		expect(out[0].values.levels).toBe(4);
		expect(out[1].keys?.levels).toHaveLength(1);
	});
});

describe("laneKeyRows", () => {
	it("shows a layer's keyed placement on the whole timeline and writes it back", () => {
		const lane: MediaLane = toggleLaneKey(
			{
				id: "l",
				name: "Media 1",
				enabled: true,
				z: 0,
				sourceId: "s",
				style: { ...DEFAULT_MEDIA_STYLE },
				clips: [],
			},
			"rotation",
			3,
			false,
		);
		const [row] = laneKeyRows(lane);
		expect(row.label).toBe("Layer · Rotation");
		expect(row.to).toBe(Infinity);
		const next = withLaneTracks(lane, new Map([[row.id, [{ t: 5, v: 90 }]]]));
		expect(next.keys?.rotation).toEqual([{ t: 5, v: 90 }]);
	});
});

describe("dragKeys", () => {
	it("moves keys in time and value, held to the range and step", () => {
		const rows = chainKeyRows(clip());
		const { tracks, picked } = dragKeys(
			rows,
			[{ row: rows[0].id, t: 2 }],
			0.5,
			0.25,
		);
		// 12 + a quarter of 2..20 is 16.5, on a step of 1.
		expect(tracks.get(rows[0].id)).toEqual([
			{ t: 0, v: 4 },
			{ t: 2.5, v: 17 },
		]);
		expect(picked).toEqual([{ row: rows[0].id, t: 2.5 }]);
	});

	it("stops the whole selection at the first clip edge it meets", () => {
		const rows = chainKeyRows(clip());
		const { picked } = dragKeys(
			rows,
			[
				{ row: rows[0].id, t: 2 },
				{ row: rows[1].id, t: 1 },
			],
			5,
			0,
		);
		expect(picked.map((p) => p.t)).toEqual([4, 3]);
	});
});

describe("pickRange", () => {
	it("picks the keys between two picks across the rows between them", () => {
		const rows = chainKeyRows(clip());
		const range = pickRange(
			rows,
			{ row: rows[0].id, t: 0 },
			{ row: rows[1].id, t: 1 },
		);
		expect(range).toEqual([
			{ row: rows[0].id, t: 0 },
			{ row: rows[1].id, t: 1 },
		]);
	});
});
