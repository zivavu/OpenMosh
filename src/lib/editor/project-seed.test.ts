import { describe, expect, test } from "bun:test";
import { createMediaClip, EMPTY_MEDIA_TIMELINE } from "../media";
import { createAudioClip, createAudioLane } from "../mix/types";
import {
	contentEnd,
	contentStart,
	DEFAULT_PROJECT_LENGTH,
	seedLength,
	seedTimeline,
} from "./project-seed";

const empty = { ...EMPTY_MEDIA_TIMELINE };

describe("seedLength", () => {
	test("takes the song, then the clips, then the media, then the default", () => {
		expect(seedLength({ songLength: 90, contentEnd: 20, mediaLength: 5 })).toBe(
			90,
		);
		expect(seedLength({ songLength: 0, contentEnd: 20, mediaLength: 5 })).toBe(
			20,
		);
		expect(seedLength({ songLength: 0, contentEnd: 0, mediaLength: 5 })).toBe(
			5,
		);
		expect(seedLength({ songLength: 0, contentEnd: 0, mediaLength: 0 })).toBe(
			DEFAULT_PROJECT_LENGTH,
		);
	});
});

describe("content extents", () => {
	test("span every lane kind, sound included", () => {
		const audio = createAudioLane("Audio 1");
		audio.clips = [createAudioClip(1, 40, "song")];
		const media = { ...empty, audioLanes: [audio] };
		const text = [{ clips: [createMediaClip(3, 12)] }];
		expect(contentEnd(media, text)).toBe(40);
		expect(contentStart(media, text)).toBe(1);
	});

	test("an empty project starts at 0 and ends at 0", () => {
		expect(contentEnd(empty)).toBe(0);
		expect(contentStart(empty)).toBe(0);
	});
});

describe("seedTimeline", () => {
	test("puts the song first on a driving lane and the media under it, muted", () => {
		const next = seedTimeline(empty, {
			length: 60,
			song: { sourceId: "song", length: 60 },
			mediaSourceId: "photo",
		});
		expect(next.audioLanes![0]).toMatchObject({ drives: true });
		expect(next.audioLanes![0]!.clips).toMatchObject([
			{ start: 0, end: 60, sourceId: "song" },
		]);
		expect(next.enabled).toBe(true);
		expect(next.lanes[0]).toMatchObject({ name: "Media 1", sourceId: "photo" });
		expect(next.lanes[0]!.clips).toMatchObject([{ start: 0, end: 60 }]);
		expect(next.lanes[0]!.audio?.muted).toBe(true);
	});

	test("leaves a song a lane already plays, and lanes that are there", () => {
		const audio = createAudioLane("Audio 1");
		audio.clips = [createAudioClip(0, 10, "song")];
		const withLane = seedTimeline(empty, {
			length: 10,
			song: null,
			mediaSourceId: "a",
		});
		const next = seedTimeline(
			{ ...withLane, audioLanes: [audio] },
			{
				length: 10,
				song: { sourceId: "song", length: 10 },
				mediaSourceId: "b",
			},
		);
		expect(next.audioLanes).toEqual([audio]);
		expect(next.lanes).toEqual(withLane.lanes);
	});

	test("media keeps its sound without a song", () => {
		const next = seedTimeline(empty, {
			length: 10,
			song: null,
			mediaSourceId: "clip",
		});
		expect(next.lanes[0]!.audio?.muted).toBe(false);
	});
});
