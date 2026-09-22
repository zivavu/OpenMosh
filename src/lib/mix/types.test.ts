import { describe, expect, it } from "bun:test";
import { normalizeMediaTimeline } from "../media/types";
import {
	createAudioClip,
	createAudioLane,
	normalizeAudioLanes,
	removeAudioSource,
	retargetAudioSource,
	splitAudioClipAt,
	trackIdOf,
	trackSourceId,
} from "./types";

describe("splitAudioClipAt", () => {
	it("picks the right half up where the left stopped, fades kept at the outer edges", () => {
		const lane = createAudioLane("Voice");
		const clip = createAudioClip(2, 10, trackSourceId("v"), 5);
		clip.fadeInSec = 1;
		clip.fadeOutSec = 1;
		lane.clips = [clip];
		const [left, right] = splitAudioClipAt(lane, 6).clips;
		expect(left).toMatchObject({
			start: 2,
			end: 6,
			sourceStart: 5,
			fadeInSec: 1,
		});
		expect(left.fadeOutSec).toBeUndefined();
		expect(right).toMatchObject({
			start: 6,
			end: 10,
			sourceStart: 9,
			fadeOutSec: 1,
		});
		expect(right.fadeInSec).toBeUndefined();
	});

	it("leaves the lane alone outside any clip", () => {
		const lane = createAudioLane("Voice");
		lane.clips = [createAudioClip(2, 10, null)];
		expect(splitAudioClipAt(lane, 11)).toBe(lane);
	});
});

describe("normalizing", () => {
	it("keeps layers saved before they had sound silent", () => {
		const t = normalizeMediaTimeline({
			enabled: true,
			lanes: [{ id: "a", clips: [] }],
		});
		expect(t.lanes[0].audio?.muted).toBe(true);
		expect(t.audioLanes).toEqual([]);
	});

	it("fills in what an audio lane dropped", () => {
		const [lane] = normalizeAudioLanes([{ clips: [{ start: 1, end: 2 }] }]);
		expect(lane).toMatchObject({
			name: "Audio 1",
			enabled: true,
			drives: false,
		});
		expect(lane.clips[0]).toMatchObject({
			start: 1,
			end: 2,
			sourceStart: 0,
			sourceId: null,
		});
	});
});

describe("song swaps", () => {
	const song = trackSourceId("a");
	const lanes = () => {
		const music = createAudioLane("Music", true);
		music.clips = [createAudioClip(0, 5, song)];
		const voice = createAudioLane("Voice");
		voice.clips = [createAudioClip(1, 2, trackSourceId("v"))];
		return [music, voice];
	};

	it("retargets every clip of the old song", () => {
		const next = retargetAudioSource(lanes(), song, trackSourceId("b"));
		expect(next[0].clips[0].sourceId).toBe(trackSourceId("b"));
		expect(next[1].clips[0].sourceId).toBe(trackSourceId("v"));
	});

	it("drops a removed song's clips, and lanes left empty", () => {
		const next = removeAudioSource(lanes(), song);
		expect(next.map((l) => l.name)).toEqual(["Voice"]);
	});

	it("tells library sources from pool ones", () => {
		expect(trackIdOf(song)).toBe("a");
		expect(trackIdOf("src:clip.mkv:1:2")).toBeNull();
	});
});
