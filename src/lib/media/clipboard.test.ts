import { describe, expect, it } from "bun:test";
import {
	copyMediaClips,
	pasteMediaClips,
	pasteMediaContentOnto,
} from "./clipboard";
import {
	createMediaClip,
	createMediaLane,
	type MediaLane,
	type MediaTimeline,
} from "./types";

function laneWith(
	spans: [number, number, number?][],
	name = "Layer 1",
): MediaLane {
	const lane = createMediaLane(name, "src-a");
	return {
		...lane,
		clips: spans.map(([s, e, into]) => createMediaClip(s, e, into ?? 0)),
	};
}

function timelineOf(lanes: MediaLane[]): MediaTimeline {
	return { enabled: true, lanes };
}

describe("copyMediaClips", () => {
	it("anchors offsets at the earliest clip", () => {
		const lane = laneWith([
			[10, 14],
			[20, 22],
		]);
		const copied = copyMediaClips(
			timelineOf([lane]),
			lane.clips.map((c) => c.id),
		);
		expect(copied.map((c) => c.offset)).toEqual([0, 10]);
		expect(copied.map((c) => c.length)).toEqual([4, 2]);
	});

	it("carries the in-point and the fade", () => {
		const lane = laneWith([[0, 5, 30]]);
		lane.clips[0].fadeInSec = 0.5;
		lane.clips[0].fadeOutSec = 0.2;
		const [entry] = copyMediaClips(timelineOf([lane]), [lane.clips[0].id]);
		expect(entry.sourceStart).toBe(30);
		expect(entry.fadeInSec).toBe(0.5);
		expect(entry.fadeOutSec).toBe(0.2);
	});

	it("carries the clip's own source", () => {
		const lane = laneWith([[0, 5]]);
		lane.clips[0].sourceId = "src-b";
		const [entry] = copyMediaClips(timelineOf([lane]), [lane.clips[0].id]);
		expect(entry.sourceId).toBe("src-b");
	});

	it("ignores ids that aren't in the timeline", () => {
		const lane = laneWith([[0, 5]]);
		expect(copyMediaClips(timelineOf([lane]), ["nope"])).toEqual([]);
	});
});

describe("pasteMediaClips", () => {
	it("keeps the copied length and in-point", () => {
		const lane = laneWith([[0, 5, 12]]);
		const t = timelineOf([lane]);
		const copied = copyMediaClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteMediaClips(t, copied, 20, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect(pasted.start).toBe(20);
		expect(pasted.end).toBe(25);
		expect(pasted.sourceStart).toBe(12);
	});

	it("pastes a retargeted clip still showing its own media", () => {
		const lane = laneWith([[0, 5]]);
		lane.clips[0].sourceId = "src-b";
		const t = timelineOf([lane]);
		const copied = copyMediaClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteMediaClips(t, copied, 20, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect(pasted.sourceId).toBe("src-b");
	});

	it("lands the copy after the original when the playhead is inside it", () => {
		const lane = laneWith([[0, 10]]);
		const t = timelineOf([lane]);
		const copied = copyMediaClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteMediaClips(t, copied, 4, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect(pasted.start).toBe(10);
		expect(pasted.end).toBe(20);
	});

	it("slides past everything in the way rather than trimming", () => {
		const lane = laneWith([
			[0, 10],
			[12, 30],
		]);
		const t = timelineOf([lane]);
		const copied = copyMediaClips(t, [lane.clips[0].id]);
		const { timeline, clipIds } = pasteMediaClips(t, copied, 5, 60);
		const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
		expect(pasted.start).toBe(30);
		expect(pasted.end).toBe(40);
	});

	it("fills what room there is when the copy is longer than the gap", () => {
		const lane = laneWith([[0, 10]]);
		const t = timelineOf([lane]);
		const copied = copyMediaClips(t, [lane.clips[0].id]);
		const result = pasteMediaClips(t, copied, 5, 15);
		expect(result.clipIds).toHaveLength(1);
		const pasted = result.timeline.lanes[0].clips[1];
		expect([pasted.start, pasted.end]).toEqual([10, 15]);
	});

	it("pastes nothing when the lane is full", () => {
		const lane = laneWith([[0, 10]]);
		const t = timelineOf([lane]);
		const copied = copyMediaClips(t, [lane.clips[0].id]);
		const result = pasteMediaClips(t, copied, 5, 10);
		expect(result.clipIds).toEqual([]);
		expect(result.timeline).toBe(t);
	});

	it("keeps a multi-lane copy's spacing and puts each clip back on its lane", () => {
		const a = laneWith([[0, 4]], "Layer 1");
		const b = laneWith([[6, 8]], "Layer 2");
		const t = timelineOf([a, b]);
		const copied = copyMediaClips(t, [a.clips[0].id, b.clips[0].id]);
		const { timeline } = pasteMediaClips(t, copied, 20, 60);
		const newA = timeline.lanes[0].clips.find((c) => c.start === 20)!;
		const newB = timeline.lanes[1].clips.find((c) => c.start === 26)!;
		expect(newA.end).toBe(24);
		expect(newB.end).toBe(28);
	});

	it("drops entries whose lane is gone", () => {
		const a = laneWith([[0, 4]], "Layer 1");
		const b = laneWith([[6, 8]], "Layer 2");
		const t = timelineOf([a, b]);
		const copied = copyMediaClips(t, [a.clips[0].id, b.clips[0].id]);
		const { timeline, clipIds } = pasteMediaClips(
			timelineOf([b]),
			copied,
			20,
			60,
		);
		expect(clipIds).toHaveLength(1);
		expect(timeline.lanes[0].clips.some((c) => c.start === 26)).toBe(true);
	});
});

describe("pasteMediaClips onto another lane", () => {
	it("lands on the target lane, pinning the source it showed", () => {
		const a = laneWith([[0, 4]], "Layer 1");
		const b = { ...laneWith([], "Layer 2"), sourceId: "src-b" };
		const t = timelineOf([a, b]);
		const copied = copyMediaClips(t, [a.clips[0].id]);
		const result = pasteMediaClips(t, copied, 0, 10, b.id);
		expect(result.timeline.lanes[0].clips).toHaveLength(1);
		const [pasted] = result.timeline.lanes[1].clips;
		expect([pasted.start, pasted.end]).toEqual([0, 4]);
		expect(pasted.sourceId).toBe("src-a");
	});

	it("leaves the source unpinned when the target lane shows the same", () => {
		const a = laneWith([[0, 4]], "Layer 1");
		const b = laneWith([], "Layer 2");
		const t = timelineOf([a, b]);
		const copied = copyMediaClips(t, [a.clips[0].id]);
		const result = pasteMediaClips(t, copied, 0, 10, b.id);
		expect(result.timeline.lanes[1].clips[0].sourceId).toBeUndefined();
	});

	it("keeps a clip following its lane when pasted back onto it", () => {
		const a = laneWith([[0, 4]], "Layer 1");
		const t = timelineOf([a]);
		const copied = copyMediaClips(t, [a.clips[0].id]);
		const result = pasteMediaClips(t, copied, 6, 10, a.id);
		expect(result.timeline.lanes[0].clips[1].sourceId).toBeUndefined();
	});
});

describe("pasteMediaContentOnto", () => {
	it("puts the source and in-point into the targets, keeping their spans", () => {
		const from = laneWith([[0, 5, 30]]);
		from.clips[0].fadeInSec = 0.5;
		const to = laneWith([[10, 12]], "Layer 2");
		to.clips[0].fadeInSec = 0.1;
		const tl = timelineOf([from, to]);
		const entries = copyMediaClips(tl, [from.clips[0].id]);
		const next = pasteMediaContentOnto(tl, [to.clips[0].id], entries);
		const target = next.lanes[1].clips[0];
		expect([target.start, target.end]).toEqual([10, 12]);
		expect(target.sourceStart).toBe(30);
		expect(target.fadeInSec).toBe(0.1);
	});

	it("pins the source it showed when the target lane shows something else", () => {
		const from = laneWith([[0, 5]]);
		const to = { ...laneWith([[10, 12]], "Layer 2"), sourceId: "src-b" };
		const tl = timelineOf([from, to]);
		const entries = copyMediaClips(tl, [from.clips[0].id]);
		const next = pasteMediaContentOnto(tl, [to.clips[0].id], entries);
		expect(next.lanes[1].clips[0].sourceId).toBe("src-a");
	});

	it("leaves the source unpinned when the target lane already shows it", () => {
		const from = laneWith([[0, 5]]);
		from.clips[0].sourceId = "src-b";
		const to = { ...laneWith([[10, 12]], "Layer 2"), sourceId: "src-b" };
		const tl = timelineOf([from, to]);
		const entries = copyMediaClips(tl, [from.clips[0].id]);
		const next = pasteMediaContentOnto(tl, [to.clips[0].id], entries);
		expect(next.lanes[1].clips[0].sourceId).toBeUndefined();
	});

	it("repeats a shorter copy over the targets in time order", () => {
		const lane = laneWith([
			[0, 1, 5],
			[2, 3, 6],
			[4, 5, 0],
			[6, 7, 0],
			[8, 9, 0],
		]);
		const tl = timelineOf([lane]);
		const entries = copyMediaClips(tl, [lane.clips[0].id, lane.clips[1].id]);
		const next = pasteMediaContentOnto(
			tl,
			[lane.clips[4].id, lane.clips[2].id, lane.clips[3].id],
			entries,
		);
		expect(next.lanes[0].clips.slice(2).map((c) => c.sourceStart)).toEqual([
			5, 6, 5,
		]);
	});
});
