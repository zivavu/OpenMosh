import { describe, expect, it } from "bun:test";
import { migrateLegacySegments } from "./legacy-segments";

const on = (defId: string) => [
	{ instanceId: `${defId}-1`, defId, enabled: true, values: {} },
];

describe("migrateLegacySegments", () => {
	it("turns each segment's chain into an fx clip over the same span", () => {
		const { fxLane } = migrateLegacySegments(
			[
				{ startTime: 0, endTime: 4, label: "mosh", effects: on("pixelate") },
				{
					startTime: 4,
					endTime: null,
					label: "auto",
					mode: "interval",
					seed: 7,
					intervalSec: 0.5,
					intervalBeats: 1,
					effects: [],
				},
			],
			10,
		);
		expect(fxLane?.clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[4, 10],
		]);
		const [a, b] = fxLane!.clips;
		expect(a.label).toBe("mosh");
		expect(a.effects.some((e) => e.defId === "pixelate" && e.enabled)).toBe(
			true,
		);
		expect(b.mode).toBe("interval");
		expect(b.seed).toBe(7);
		expect(b.intervalBeats).toBe(1);
	});

	it("skips clean static segments, and the lane when none contribute", () => {
		const { fxLane } = migrateLegacySegments(
			[{ startTime: 0, endTime: 5, label: "clean", effects: [] }],
			5,
		);
		expect(fxLane).toBeNull();
	});

	it("puts segments that named a source on a media lane under the effects", () => {
		const { mediaLane } = migrateLegacySegments(
			[
				{ startTime: 0, endTime: 3, sourceId: "src-a", effects: [] },
				{ startTime: 3, endTime: 6, effects: [] },
				{ startTime: 6, endTime: 9, sourceId: "src-b", effects: [] },
			],
			9,
		);
		expect(mediaLane?.underEffects).toBe(true);
		expect(mediaLane?.clips.map((c) => [c.start, c.end, c.sourceId])).toEqual([
			[0, 3, "src-a"],
			[6, 9, "src-b"],
		]);
	});

	it("ends an open-ended segment at the next one, or the song", () => {
		const { mediaLane } = migrateLegacySegments(
			[
				{ startTime: 0, sourceId: "src-a", effects: [] },
				{ startTime: 2, sourceId: "src-a", effects: [] },
			],
			8,
		);
		expect(mediaLane?.clips.map((c) => [c.start, c.end])).toEqual([
			[0, 2],
			[2, 8],
		]);
	});

	it("hands back nothing for an empty or malformed list", () => {
		expect(migrateLegacySegments(undefined, 10)).toEqual({
			fxLane: null,
			mediaLane: null,
		});
		expect(migrateLegacySegments([{}], 10)).toEqual({
			fxLane: null,
			mediaLane: null,
		});
	});
});
