import { describe, expect, test } from "bun:test";
import { autoOnSlideshow, autoOnSlideshows } from "./chain";
import {
	createMediaClip,
	createMediaLane,
	EMPTY_MEDIA_TIMELINE,
	type MediaTimeline,
} from "./types";

describe("autoOnSlideshow", () => {
	test("starts a clean clip on a slideshow in auto", () => {
		const clip = autoOnSlideshow(createMediaClip(0, 4), true);
		expect(clip.mode).toBe("interval");
		expect(typeof clip.seed).toBe("number");
	});

	test("leaves other media alone", () => {
		expect(autoOnSlideshow(createMediaClip(0, 4), false).mode).toBe("static");
	});

	test("keeps a chain the clip already has", () => {
		const clip = createMediaClip(0, 4);
		clip.effects[0] = { ...clip.effects[0], enabled: true };
		expect(autoOnSlideshow(clip, true)).toBe(clip);
	});

	test("goes by the source a clip inherits from its lane", () => {
		const lane = createMediaLane("Media 1", "cuts-1", 0);
		lane.clips = [createMediaClip(0, 4), createMediaClip(4, 8, 0, "img-1")];
		const timeline: MediaTimeline = { ...EMPTY_MEDIA_TIMELINE, lanes: [lane] };
		const next = autoOnSlideshows(
			timeline,
			lane.clips.map((c) => c.id),
			(id) => id === "cuts-1",
		);
		expect(next.lanes[0].clips.map((c) => c.mode)).toEqual([
			"interval",
			"static",
		]);
	});
});
