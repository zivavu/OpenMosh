import { describe, expect, it } from "bun:test";
import { copyAudioClips, pasteAudioClips } from "./clipboard";
import { createAudioClip, createAudioLane, trackSourceId } from "./types";

describe("audio clipboard", () => {
	it("pastes a part of the song onto an empty lane, same sound", () => {
		const music = createAudioLane("Music", true);
		const clip = {
			...createAudioClip(10, 14, trackSourceId("s"), 10),
			gain: 0.5,
		};
		music.clips = [clip];
		const spare = createAudioLane("Spare");
		const lanes = [music, spare];

		const copied = copyAudioClips(lanes, [clip.id]);
		const { lanes: next, clipIds } = pasteAudioClips(
			lanes,
			copied,
			30,
			60,
			spare.id,
		);

		expect(clipIds).toHaveLength(1);
		expect(next[0].clips).toEqual([clip]);
		expect(next[1].clips[0]).toMatchObject({
			id: clipIds[0],
			start: 30,
			end: 34,
			sourceId: trackSourceId("s"),
			sourceStart: 10,
			gain: 0.5,
		});
	});

	it("keeps all lanes of a multi-lane copy when targeting the bottom lane", () => {
		const top = createAudioLane("Music", true);
		const topClip = createAudioClip(0, 4, trackSourceId("a"), 0);
		top.clips = [topClip];
		const bottom = createAudioLane("SFX");
		const bottomClip = createAudioClip(2, 5, trackSourceId("b"), 1);
		bottom.clips = [bottomClip];
		const lanes = [top, bottom];

		const copied = copyAudioClips(lanes, [topClip.id, bottomClip.id]);
		const { lanes: next, clipIds } = pasteAudioClips(
			lanes,
			copied,
			20,
			60,
			bottom.id,
		);

		expect(clipIds).toHaveLength(2);
		expect(next[0].clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[20, 24],
		]);
		expect(next[1].clips.map((c) => [c.start, c.end])).toEqual([
			[2, 5],
			[22, 25],
		]);
	});
});
