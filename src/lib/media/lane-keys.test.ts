import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MEDIA_STYLE,
	normalizeMediaTimeline,
	resolveMediaLayersAt,
	type MediaLane,
} from ".";
import { laneKeyRows, withLaneTracks } from "../timeline/key-rows";
import {
	clearLaneKeys,
	groupPlacement,
	laneGroupNames,
	setPlacementGroupRange,
	ungroupPlacement,
	laneKeyTimes,
	laneStyleAt,
	normalizeLaneKeys,
	removeLaneKeysAt,
	repeatLaneKeys,
	setLaneStyleAt,
	simplifyLaneKeys,
	toggleLaneKey,
} from "./lane-keys";

function lane(over: Partial<MediaLane> = {}): MediaLane {
	return {
		id: "l",
		name: "Media 1",
		enabled: true,
		z: 0,
		sourceId: "src",
		style: { ...DEFAULT_MEDIA_STYLE },
		clips: [
			{
				id: "a",
				start: 0,
				end: 4,
				sourceStart: 0,
				label: "clean",
				effects: [],
			},
			{
				id: "b",
				start: 4,
				end: 8,
				sourceStart: 0,
				label: "clean",
				effects: [],
			},
		],
		...over,
	};
}

/** x from 0.2 at 0s to 0.8 at 8s. */
function sliding(): MediaLane {
	let l = toggleLaneKey(
		lane({ style: { ...DEFAULT_MEDIA_STYLE, x: 0.2 } }),
		"x",
		0,
		false,
	);
	l = setLaneStyleAt(l, { ...laneStyleAt(l, 8), x: 0.8 }, 8);
	return l;
}

describe("lane placement keys", () => {
	it("moves the layer along its keys, across every clip", () => {
		const l = sliding();
		expect(laneStyleAt(l, 4).x).toBeCloseTo(0.5);
		const [layer] = resolveMediaLayersAt({ enabled: true, lanes: [l] }, 6);
		expect(layer.clipId).toBe("b");
		expect(layer.style.x).toBeCloseTo(0.65);
	});

	it("writes an unkeyed value as it is and keys only what moved", () => {
		const l = setLaneStyleAt(
			sliding(),
			{ ...laneStyleAt(sliding(), 2), scale: 2 },
			2,
		);
		expect(l.style.scale).toBe(2);
		expect(laneKeyTimes(l)).toEqual([0, 8]);
	});

	it("skips a layer keyed fully transparent", () => {
		let l = toggleLaneKey(lane(), "opacity", 0, false);
		l = setLaneStyleAt(l, { ...l.style, opacity: 0 }, 4);
		expect(resolveMediaLayersAt({ enabled: true, lanes: [l] }, 5)).toEqual([]);
	});

	it("holds the value its first key had once every key is gone", () => {
		const l = removeLaneKeysAt(sliding(), [0, 8]);
		expect(l.keys).toBeUndefined();
		expect(l.style.x).toBeCloseTo(0.2);
		expect(clearLaneKeys(sliding()).style.x).toBeCloseTo(0.2);
	});

	it("simplifies a dense pass", () => {
		let l = toggleLaneKey(lane(), "x", 0, false);
		for (let i = 1; i <= 40; i++)
			l = setLaneStyleAt(
				l,
				{ ...laneStyleAt(l, i / 10), x: 0.5 + i / 100 },
				i / 10,
			);
		expect(simplifyLaneKeys(l).keys?.x).toHaveLength(2);
	});

	it("repeats its run to the end of the lane", () => {
		const l = repeatLaneKeys(
			toggleLaneKey(
				toggleLaneKey(lane(), "rotation", 0, false),
				"rotation",
				2,
				false,
			),
			8,
		);
		expect(laneKeyTimes(l)).toEqual([0, 2, 4, 6, 8]);
	});

	it("reads back only finite keys, opacity held to 0..1", () => {
		expect(
			normalizeLaneKeys({
				opacity: [{ t: 0, v: 5 }],
				x: [{ t: 1, v: "no" }],
				bogus: [{ t: 0, v: 1 }],
			}),
		).toEqual({ opacity: [{ t: 0, v: 1 }], x: [{ t: 1, v: 0 }] });
	});
});

describe("layer placement groups", () => {
	it("moves x and rotation together on one curve, each in its own range", () => {
		let l = groupPlacement(sliding(), "x", null, 0);
		l = groupPlacement(l, "rotation", "A", 0);
		l = setPlacementGroupRange(l, "rotation", { min: 0, max: 90 });
		const at = laneStyleAt(l, 4);
		expect(at.x).toBeCloseTo(0.5);
		expect(at.rotation).toBe(45);
		expect(laneGroupNames(l)).toEqual(["A"]);
	});

	it("keys the curve when a grouped value is dragged, and shows as one row", () => {
		let l = groupPlacement(sliding(), "x", null, 0);
		l = groupPlacement(l, "opacity", "A", 0);
		l = setLaneStyleAt(l, { ...laneStyleAt(l, 4), x: 0.8 }, 4);
		expect(l.keyLinks!.opacity!.keys).toEqual(l.keyLinks!.x!.keys);
		expect(laneStyleAt(l, 4).x).toBeCloseTo(0.8);
		const rows = laneKeyRows(l);
		expect(rows.map((r) => r.label)).toEqual(["Layer group A · 2 values"]);
		const next = withLaneTracks(l, new Map([[rows[0].id, [{ t: 1, v: 0 }]]]));
		expect(next.keyLinks!.opacity!.keys).toEqual([{ t: 1, v: 0 }]);
	});

	it("leaving keeps the motion, and a save reads it back", () => {
		const grouped = groupPlacement(sliding(), "x", null, 0);
		const left = ungroupPlacement(grouped, "x");
		expect(left.keyLinks).toBeUndefined();
		expect(left.keys?.x?.map((k) => k.v)).toEqual([0.2, 0.8]);
		const [read] = normalizeMediaTimeline({
			enabled: true,
			lanes: [JSON.parse(JSON.stringify(grouped))],
		}).lanes;
		expect(read.keyLinks).toEqual(grouped.keyLinks);
	});
});
