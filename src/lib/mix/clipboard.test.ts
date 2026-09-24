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
});
