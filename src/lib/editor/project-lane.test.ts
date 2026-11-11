import { describe, expect, test } from "bun:test";
import { createMediaClip, EMPTY_MEDIA_TIMELINE } from "../media";
import { createAudioLane } from "../mix/types";
import { addProjectLane } from "./project-lane";

const base = { ...EMPTY_MEDIA_TIMELINE, enabled: true };

describe("addProjectLane", () => {
	test("puts the clip alone on a new named lane on top", () => {
		const clip = createMediaClip(2, 7);
		const { timeline, laneId } = addProjectLane(base, {
			sourceId: "src",
			name: "My slideshow",
			clip,
			z: 4,
		});
		const lane = timeline.lanes.at(-1)!;
		expect(lane.id).toBe(laneId);
		expect(lane.name).toBe("My slideshow");
		expect(lane.sourceId).toBe("src");
		expect(lane.z).toBe(4);
		expect(lane.clips).toEqual([clip]);
		expect(timeline.audioLanes ?? []).toEqual([]);
	});

	test("lays the song under the clip's span", () => {
		const existing = createAudioLane("Audio 1");
		const { timeline } = addProjectLane(
			{ ...base, audioLanes: [existing] },
			{
				sourceId: "src",
				name: "Edit",
				clip: createMediaClip(3, 8),
				z: 0,
				song: { sourceId: "song", sourceStart: 12, asSong: false },
			},
		);
		const lanes = timeline.audioLanes!;
		expect(lanes[0]).toBe(existing);
		const added = lanes[1]!;
		expect(added.name).toBe("Audio 2");
		expect(added.drives).toBe(false);
		expect(added.clips).toMatchObject([
			{ start: 3, end: 8, sourceId: "song", sourceStart: 12 },
		]);
	});

	test("the project's song goes first and drives", () => {
		const existing = createAudioLane("Audio 1");
		const { timeline } = addProjectLane(
			{ ...base, audioLanes: [existing] },
			{
				sourceId: "src",
				name: "Edit",
				clip: createMediaClip(0, 1),
				z: 0,
				song: { sourceId: "song", sourceStart: 0, asSong: true },
			},
		);
		expect(timeline.audioLanes![0]!.drives).toBe(true);
		expect(timeline.audioLanes![1]).toBe(existing);
	});
});
