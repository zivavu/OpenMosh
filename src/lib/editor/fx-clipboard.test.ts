import { describe, expect, it } from "bun:test";
import { copyFxClips, pasteFxClips } from "./fx-clipboard";
import { createFxClip, createFxLane, type FxLane } from "./fx-lanes";

function laneWith(spans: [number, number][], name = "FX 1"): FxLane {
	const lane = createFxLane(name);
	lane.clips = spans.map(([s, e]) => createFxClip(s, e));
	return lane;
}

describe("copyFxClips", () => {
	it("anchors offsets at the earliest clip and keeps the fade", () => {
		const lane = laneWith([
			[10, 14],
			[20, 22],
		]);
		lane.clips[1].fadeSec = 0.3;
		lane.clips[1].label = "mosh";
		const copied = copyFxClips(
			[lane],
			lane.clips.map((c) => c.id),
		);
		expect(copied.map((c) => [c.offset, c.length])).toEqual([
			[0, 4],
			[10, 2],
		]);
		expect(copied[1].fadeSec).toBe(0.3);
		expect(copied[1].chain.label).toBe("mosh");
	});
});

describe("pasteFxClips", () => {
	it("stamps copies at the marker on their own lanes, with fresh ids", () => {
		const a = laneWith([[0, 2]]);
		const b = laneWith([[1, 3]], "FX 2");
		const entries = copyFxClips([a, b], [a.clips[0].id, b.clips[0].id]);
		const { lanes, clipIds } = pasteFxClips([a, b], entries, 10, 60);
		expect(clipIds).toHaveLength(2);
		expect(lanes[0].clips.map((c) => [c.start, c.end])).toEqual([
			[0, 2],
			[10, 12],
		]);
		expect(lanes[1].clips.map((c) => [c.start, c.end])).toEqual([
			[1, 3],
			[11, 13],
		]);
		const pasted = lanes[0].clips[1];
		expect(pasted.id).not.toBe(a.clips[0].id);
		expect(pasted.effects.map((e) => e.instanceId)).not.toEqual(
			a.clips[0].effects.map((e) => e.instanceId),
		);
	});

	it("slides right past whatever is in the way, at full length", () => {
		const lane = laneWith([[0, 4]]);
		const entries = copyFxClips([lane], [lane.clips[0].id]);
		const { lanes } = pasteFxClips([lane], entries, 2, 60);
		expect(lanes[0].clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[4, 8],
		]);
	});

	it("fills the gap at the marker when nothing has room at full length", () => {
		const lane = laneWith([
			[0, 4],
			[7, 10],
		]);
		const entries = copyFxClips([lane], [lane.clips[0].id]);
		const { lanes, clipIds } = pasteFxClips([lane], entries, 5, 10);
		expect(clipIds).toHaveLength(1);
		expect(lanes[0].clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[5, 7],
			[7, 10],
		]);
	});

	it("lands on the target lane when given one", () => {
		const a = laneWith([[0, 2]]);
		const b = laneWith([], "FX 2");
		const entries = copyFxClips([a], [a.clips[0].id]);
		const { lanes } = pasteFxClips([a, b], entries, 5, 60, b.id);
		expect(lanes[0].clips).toHaveLength(1);
		expect(lanes[1].clips.map((c) => [c.start, c.end])).toEqual([[5, 7]]);
	});

	it("pastes nothing when the lane is full", () => {
		const lane = laneWith([[0, 6]]);
		const entries = copyFxClips([lane], [lane.clips[0].id]);
		const result = pasteFxClips([lane], entries, 2, 6);
		expect(result.clipIds).toEqual([]);
		expect(result.lanes[0].clips).toHaveLength(1);
	});
});
