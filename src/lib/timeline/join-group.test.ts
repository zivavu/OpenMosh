import { describe, expect, it } from "bun:test";
import {
	copyJoins,
	joinDeltaLimits,
	joinPastePoints,
	joinRefs,
	moveJoins,
	pasteJoins,
} from "./join-group";
import { MIN_CLIP_LENGTH, type TimelineClip } from "./clips";

interface Clip extends TimelineClip {
	tag?: string;
}
interface Lane {
	id: string;
	clips: Clip[];
}

let n = 0;
function lane(id: string, edges: number[]): Lane {
	const clips: Clip[] = [];
	for (let i = 0; i + 1 < edges.length; i++) {
		clips.push({ id: `${id}${n++}`, start: edges[i], end: edges[i + 1] });
	}
	return { id, clips };
}

function split(l: Lane, at: number): Lane {
	const c = l.clips.find((x) => at > x.start && at < x.end);
	if (!c) return l;
	return {
		...l,
		clips: [
			...l.clips.filter((x) => x !== c),
			{ ...c, end: at },
			{ ...c, id: `${c.id}r`, start: at },
		].sort((a, b) => a.start - b.start),
	};
}

describe("moving joins together", () => {
	it("moves every selected join by the same amount", () => {
		const a = lane("a", [0, 2, 4, 6]);
		const joins = joinRefs([a], [a.clips[1].id, a.clips[2].id]);
		const [moved] = moveJoins([a], joins, 0.5);
		expect(moved.clips.map((c) => [c.start, c.end])).toEqual([
			[0, 2.5],
			[2.5, 4.5],
			[4.5, 6],
		]);
	});

	it("stops where a clip with a fixed edge would get too short", () => {
		const a = lane("a", [0, 2, 4, 6]);
		const joins = joinRefs([a], [a.clips[1].id, a.clips[2].id]);
		const { min, max } = joinDeltaLimits([a], joins);
		expect(min).toBeCloseTo(MIN_CLIP_LENGTH - 2);
		expect(max).toBeCloseTo(2 - MIN_CLIP_LENGTH);
	});

	it("moves joins on several lanes", () => {
		const a = lane("a", [0, 2, 4]);
		const b = lane("b", [0, 3, 4]);
		const joins = joinRefs([a, b], [a.clips[1].id, b.clips[1].id]);
		const [ma, mb] = moveJoins([a, b], joins, -1);
		expect(ma.clips[1].start).toBe(1);
		expect(mb.clips[1].start).toBe(2);
	});
});

describe("copying and pasting joins", () => {
	it("keeps the pattern's spacing and lanes, and what each join carried", () => {
		const a = lane("a", [0, 2, 3, 8]);
		const b = lane("b", [0, 2.5, 8]);
		a.clips[1].tag = "whip";
		const order = ["a", "b"];
		const copied = copyJoins(
			[a, b],
			joinRefs([a, b], [a.clips[1].id, a.clips[2].id, b.clips[1].id]),
			order,
			(c) => c.tag,
		);
		expect(copied).toEqual([
			{ offset: 0, laneOffset: 0, data: "whip" },
			{ offset: 0.5, laneOffset: 1, data: undefined },
			{ offset: 1, laneOffset: 0, data: undefined },
		]);

		const fresh = [lane("a", [0, 10]), lane("b", [0, 10])];
		const points = joinPastePoints(copied, order, "a", 5, 10);
		const { lanes, rightIds } = pasteJoins(fresh, points, split, (c, tag) => ({
			...c,
			tag,
		}));
		expect(lanes[0].clips.map((c) => c.start)).toEqual([0, 5, 6]);
		expect(lanes[1].clips.map((c) => c.start)).toEqual([0, 5.5]);
		expect(lanes[0].clips[1].tag).toBe("whip");
		expect(rightIds).toHaveLength(3);
	});

	it("drops joins that land past the lanes or the track", () => {
		const copied = [
			{ offset: 0, laneOffset: 0, data: 1 },
			{ offset: 1, laneOffset: 1, data: 2 },
			{ offset: 5, laneOffset: 0, data: 3 },
		];
		const points = joinPastePoints(copied, ["a", "b"], "b", 7, 10);
		expect(points).toEqual([{ laneId: "b", at: 7, data: 1 }]);
	});
});
