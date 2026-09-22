import { describe, expect, it } from "bun:test";
import { dragClipsStep, laneSnapPoints, type ClipDrag } from "./clip-drag";
import type { ClipLane, TimelineClip } from "./clips";

const clip = (id: string, start: number, end: number): TimelineClip => ({
	id,
	start,
	end,
});
const laneOf = (...clips: TimelineClip[]): ClipLane<TimelineClip> => ({
	clips,
});
const spans = (lane: ClipLane<TimelineClip>) =>
	lane.clips.map((c) => [c.id, c.start, c.end]);
const noSnap = () => 0;
const move = (clipId: string, grabOffset = 0): ClipDrag => ({
	laneId: "l",
	clipId,
	mode: "move",
	grabOffset,
});

describe("dragClipsStep", () => {
	it("moves the held clip to the pointer, less the grab offset", () => {
		const { lane, edges } = dragClipsStep(
			laneOf(clip("a", 0, 1)),
			move("a", 0.25),
			2.25,
			[],
			10,
			noSnap,
		);
		expect(spans(lane)).toEqual([["a", 2, 3]]);
		expect(edges).toEqual([2, 3]);
	});

	it("offers both edges of every moving clip to the snap, excluding them", () => {
		let seen: { edges: number[]; exclude: string[] } | null = null;
		dragClipsStep(
			laneOf(clip("a", 0, 1), clip("b", 2, 3), clip("c", 5, 6)),
			move("a"),
			1,
			["a", "b"],
			10,
			(edges, exclude) => {
				seen = { edges, exclude: [...exclude] };
				return 0;
			},
		);
		expect(seen).toEqual({ edges: [1, 2, 3, 4], exclude: ["a", "b"] });
	});

	it("applies the snap's shift, then the lane's limits", () => {
		const { lane, edges } = dragClipsStep(
			laneOf(clip("a", 0, 1), clip("b", 2, 3)),
			move("a"),
			0.9,
			[],
			10,
			() => 0.5, // wants a to land at 1.4-2.4, but b starts at 2
		);
		expect(spans(lane)).toEqual([
			["a", 1, 2],
			["b", 2, 3],
		]);
		expect(edges).toEqual([1, 2]);
	});

	it("snaps only the dragged edge on a resize", () => {
		let seen: number[] = [];
		const { lane, edges } = dragClipsStep(
			laneOf(clip("a", 0, 1)),
			{ laneId: "l", clipId: "a", mode: "end", grabOffset: 0 },
			1.95,
			[],
			10,
			(e) => {
				seen = e;
				return 0.05;
			},
		);
		expect(seen).toEqual([1.95]);
		expect(spans(lane)).toEqual([["a", 0, 2]]);
		expect(edges).toEqual([2]);
	});

	it("moves a shared boundary, keeping both clips out of the snap", () => {
		let exclude: string[] = [];
		const { lane, edges } = dragClipsStep(
			laneOf(clip("a", 0, 1), clip("b", 1, 2)),
			{
				laneId: "l",
				clipId: "a",
				otherId: "b",
				mode: "boundary",
				grabOffset: 0,
			},
			1.5,
			[],
			10,
			(_, ex) => {
				exclude = [...ex];
				return 0;
			},
		);
		expect(exclude).toEqual(["a", "b"]);
		expect(spans(lane)).toEqual([
			["a", 0, 1.5],
			["b", 1.5, 2],
		]);
		expect(edges).toEqual([1.5]);
	});
});

describe("laneSnapPoints", () => {
	it("lists both edges of each clip, owned by it", () => {
		expect(laneSnapPoints(laneOf(clip("b", 2, 3), clip("a", 0, 1)))).toEqual([
			{ time: 0, ownerId: "a" },
			{ time: 1, ownerId: "a" },
			{ time: 2, ownerId: "b" },
			{ time: 3, ownerId: "b" },
		]);
		expect(laneSnapPoints(undefined)).toEqual([]);
	});
});
