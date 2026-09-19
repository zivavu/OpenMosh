import { describe, expect, it } from "bun:test";
import { copyTextClips, pasteTextClips, pasteTextOnto } from "./clipboard";
import {
	createTextClip,
	createTextLane,
	type TextLane,
	type TextTimeline,
} from "./types";

function laneWith(
	spans: [number, number, string][],
	name = "Text 1",
): TextLane {
	return {
		...createTextLane(name),
		clips: spans.map(([s, e, text]) => createTextClip(s, e, text)),
	};
}

function timelineOf(lanes: TextLane[]): TextTimeline {
	return { enabled: true, lanes };
}

describe("copyTextClips", () => {
	it("anchors offsets at the earliest clip and keeps the words", () => {
		const lane = laneWith([
			[10, 14, "one"],
			[2, 5, "two"],
		]);
		const copied = copyTextClips(
			timelineOf([lane]),
			lane.clips.map((c) => c.id),
		);
		expect(copied.map((e) => [e.offset, e.length, e.text])).toEqual([
			[0, 3, "two"],
			[8, 4, "one"],
		]);
	});

	it("ignores ids it can't find", () => {
		expect(copyTextClips(timelineOf([laneWith([])]), ["nope"])).toEqual([]);
	});
});

describe("pasteTextClips", () => {
	it("stamps a copy with its length and words at the marker", () => {
		const lane = laneWith([[0, 5, "hi"]]);
		const t = timelineOf([lane]);
		const copied = copyTextClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteTextClips(t, copied, 20, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect([pasted.start, pasted.end, pasted.text]).toEqual([20, 25, "hi"]);
		expect(pasted.id).not.toBe(lane.clips[0].id);
	});

	it("carries the chain, with fresh effect instances", () => {
		const lane = laneWith([[0, 5, "hi"]]);
		lane.clips[0].label = "mosh";
		lane.clips[0].effects[0].enabled = true;
		const t = timelineOf([lane]);
		const copied = copyTextClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteTextClips(t, copied, 20, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect(pasted.label).toBe("mosh");
		expect(pasted.effects[0].enabled).toBe(true);
		expect(pasted.effects[0].instanceId).not.toBe(
			lane.clips[0].effects[0].instanceId,
		);
	});

	it("carries the fades along", () => {
		const lane = laneWith([[0, 5, "hi"]]);
		lane.clips[0].fadeInSec = 0.5;
		const t = timelineOf([lane]);
		const copied = copyTextClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteTextClips(t, copied, 20, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect(pasted.fadeInSec).toBe(0.5);
		expect(pasted).not.toHaveProperty("fadeOutSec");
	});

	it("lands after the original when the marker is inside it", () => {
		const lane = laneWith([[0, 10, "hi"]]);
		const t = timelineOf([lane]);
		const copied = copyTextClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteTextClips(t, copied, 4, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect([pasted.start, pasted.end]).toEqual([10, 20]);
	});

	it("goes to the target lane when given one", () => {
		const a = laneWith([[0, 5, "hi"]], "A");
		const b = laneWith([], "B");
		const t = timelineOf([a, b]);
		const copied = copyTextClips(t, [a.clips[0].id]);
		const { timeline, clipIds } = pasteTextClips(t, copied, 0, 60, b.id);
		expect(timeline.lanes[0].clips).toHaveLength(1);
		expect(timeline.lanes[1].clips.map((c) => c.id)).toEqual(clipIds);
	});

	it("is a no-op with nothing copied or no duration", () => {
		const t = timelineOf([laneWith([[0, 5, "hi"]])]);
		expect(pasteTextClips(t, [], 0, 60).clipIds).toEqual([]);
		const copied = copyTextClips(t, [t.lanes[0].clips[0].id]);
		expect(pasteTextClips(t, copied, 0, 0).timeline).toBe(t);
	});
});

describe("pasteTextOnto", () => {
	it("swaps the words and keeps the span, repeating a shorter copy", () => {
		const src = laneWith([
			[0, 2, "a"],
			[3, 5, "b"],
		]);
		const dst = laneWith(
			[
				[0, 1, "x"],
				[2, 3, "y"],
				[4, 9, "z"],
			],
			"Text 2",
		);
		const t = timelineOf([src, dst]);
		const copied = copyTextClips(
			t,
			src.clips.map((c) => c.id),
		);
		const out = pasteTextOnto(
			t,
			dst.clips.map((c) => c.id),
			copied,
		);
		expect(out.lanes[1].clips.map((c) => [c.start, c.end, c.text])).toEqual([
			[0, 1, "a"],
			[2, 3, "b"],
			[4, 9, "a"],
		]);
		expect(out.lanes[0]).toBe(src);
		// The chain comes with the words; the target keeps its own id.
		expect(out.lanes[1].clips[0].id).toBe(dst.clips[0].id);
		expect(out.lanes[1].clips[0].effects).not.toBe(src.clips[0].effects);
	});
});
