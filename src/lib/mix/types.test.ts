import { describe, expect, it } from "bun:test";
import { createSourceEdit } from "../media/source-edit";
import { normalizeMediaTimeline } from "../media/types";
import {
	createAudioClip,
	createAudioLane,
	normalizeAudioLanes,
	removeAudioSource,
	removeAudioSourceIn,
	retargetAudioSource,
	setAudioClipSources,
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

	it("walks a video's sound at the picture's speed, inside its trim", () => {
		const lane = createAudioLane("Voice");
		lane.clips = [createAudioClip(0, 10, "vid", 0)];
		const edit = {
			...createSourceEdit(),
			speed: 2,
			span: { start: 1, end: 5 },
		};
		const right = splitAudioClipAt(lane, 1.5, { vid: edit }).clips[1];
		expect(right.sourceStart).toBe(4);
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

	it("swaps the sound of only the clips a track is dropped on", () => {
		const before = lanes();
		const next = setAudioClipSources(
			before,
			[before[1].clips[0].id],
			trackSourceId("b"),
		);
		expect(next[0]).toBe(before[0]);
		expect(next[1].clips[0]).toMatchObject({
			start: 1,
			end: 2,
			sourceId: trackSourceId("b"),
		});
	});

	it("drops a removed song's clips, and lanes left empty", () => {
		const next = removeAudioSource(lanes(), song);
		expect(next.map((l) => l.name)).toEqual(["Voice"]);
	});

	it("keeps a lane that was empty before the song went", () => {
		const next = removeAudioSource(
			[...lanes(), createAudioLane("Spare")],
			song,
		);
		expect(next.map((l) => l.name)).toEqual(["Voice", "Spare"]);
	});

	it("tells library sources from pool ones", () => {
		expect(trackIdOf(song)).toBe("a");
		expect(trackIdOf("src:clip.mkv:1:2")).toBeNull();
	});
});

describe("removeAudioSourceIn", () => {
	it("drops only that source's clips overlapping the span, and lanes it empties", () => {
		const detached = createAudioLane("Audio 2");
		detached.clips = [createAudioClip(2, 6, "vid")];
		const shared = createAudioLane("Audio 1");
		const song = createAudioClip(0, 10, trackSourceId("s"));
		const later = createAudioClip(12, 14, "vid");
		shared.clips = [song, later];
		const out = removeAudioSourceIn([shared, detached], "vid", 2, 6);
		expect(out).toHaveLength(1);
		expect(out[0].clips).toEqual([song, later]);
	});

	it("returns the same lanes when nothing overlaps", () => {
		const lane = createAudioLane("Audio 1");
		lane.clips = [createAudioClip(6, 8, "vid")];
		const lanes = [lane];
		expect(removeAudioSourceIn(lanes, "vid", 2, 6)).toBe(lanes);
	});
});
