import { describe, expect, it } from "bun:test";
import { createMediaClip, createMediaLane, duplicateMediaLane } from "./types";

describe("duplicateMediaLane", () => {
	it("copies clips and chains under fresh ids", () => {
		const lane = {
			...createMediaLane("Media 1", "src-a", 2),
			clips: [createMediaClip(0, 4, 0), createMediaClip(6, 9, 1)],
		};
		const copy = duplicateMediaLane(lane, 5);

		expect(copy.id).not.toBe(lane.id);
		expect(copy.name).toBe("Media 1 copy");
		expect(copy.z).toBe(5);
		expect(copy.sourceId).toBe("src-a");
		expect(copy.clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[6, 9],
		]);
		copy.clips.forEach((clip, i) => {
			const from = lane.clips[i];
			expect(clip.id).not.toBe(from.id);
			expect(clip.effects.map((e) => e.defId)).toEqual(
				from.effects.map((e) => e.defId),
			);
			clip.effects.forEach((e, j) =>
				expect(e.instanceId).not.toBe(from.effects[j].instanceId),
			);
		});
	});
});
