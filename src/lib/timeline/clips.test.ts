import { describe, expect, it } from "bun:test";
import {
	addClip,
	clipAt,
	clipFadeWeight,
	clipRange,
	fitClipsToDuration,
	freeRangeAt,
	MIN_CLIP_LENGTH,
	moveClip,
	moveClips,
	removeClip,
	resizeBoundary,
	resizeClip,
	sortClips,
	updateLaneIn,
	type ClipLane,
	type TimelineClip,
} from "./clips";

function clip(id: string, start: number, end: number): TimelineClip {
	return { id, start, end };
}

function laneOf(...clips: TimelineClip[]): ClipLane<TimelineClip> {
	return { clips };
}

/** Just the geometry, in time order — what every assertion here cares about. */
function spans(lane: ClipLane<TimelineClip>) {
	return sortClips(lane.clips).map((c) => [c.id, c.start, c.end]);
}

describe("sortClips", () => {
	it("orders by start without touching the input", () => {
		const clips = [clip("b", 5, 6), clip("a", 1, 2)];
		expect(sortClips(clips).map((c) => c.id)).toEqual(["a", "b"]);
		expect(clips.map((c) => c.id)).toEqual(["b", "a"]);
	});
});

describe("clipAt", () => {
	const lane = laneOf(clip("a", 0, 2), clip("b", 2, 4));

	it("treats a clip as [start, end), so flush neighbours never both match", () => {
		expect(clipAt(lane, 0)?.id).toBe("a");
		expect(clipAt(lane, 1.999)?.id).toBe("a");
		expect(clipAt(lane, 2)?.id).toBe("b");
	});

	it("is null past the last clip and in a gap", () => {
		expect(clipAt(lane, 4)).toBeNull();
		expect(clipAt(laneOf(clip("a", 0, 1), clip("b", 3, 4)), 2)).toBeNull();
	});
});

describe("clipRange", () => {
	const lane = laneOf(clip("c", 4, 5), clip("a", 0, 1), clip("b", 2, 3));

	it("spans the two ids in time order, whichever way they were clicked", () => {
		expect(clipRange(lane, "a", "c")).toEqual(["a", "b", "c"]);
		expect(clipRange(lane, "c", "a")).toEqual(["a", "b", "c"]);
	});

	it("is just the anchor when both ids are the same clip", () => {
		expect(clipRange(lane, "b", "b")).toEqual(["b"]);
	});

	it("falls back to the clicked clip when the anchor is on another lane", () => {
		expect(clipRange(lane, "elsewhere", "b")).toEqual(["b"]);
	});

	it("is empty when the clicked clip isn't on this lane", () => {
		expect(clipRange(lane, "a", "elsewhere")).toEqual([]);
	});
});

describe("freeRangeAt", () => {
	it("is bounded by the neighbours on both sides", () => {
		const lane = laneOf(clip("a", 0, 1), clip("b", 3, 4));
		expect(freeRangeAt(lane, 2, 10)).toEqual({ start: 1, end: 3 });
	});

	it("runs to the ends of the timeline with nothing in the way", () => {
		expect(freeRangeAt(laneOf(), 5, 10)).toEqual({ start: 0, end: 10 });
	});

	it("is null on a clip", () => {
		expect(freeRangeAt(laneOf(clip("a", 0, 2)), 1, 10)).toBeNull();
	});

	it("finds the gap from the instant a clip ends", () => {
		// The half-open convention has to hold here too, or a click flush against
		// a clip's tail would report itself as occupied.
		expect(freeRangeAt(laneOf(clip("a", 0, 2)), 2, 10)).toEqual({
			start: 2,
			end: 10,
		});
	});

	it("refuses a gap too short to hold a clip", () => {
		const tight = laneOf(
			clip("a", 0, 1),
			clip("b", 1 + MIN_CLIP_LENGTH / 2, 4),
		);
		expect(freeRangeAt(tight, 1, 10)).toBeNull();
	});
});

describe("moveClip", () => {
	it("keeps the clip's length", () => {
		const lane = moveClip(laneOf(clip("a", 1, 3)), "a", 5, 10);
		expect(spans(lane)).toEqual([["a", 5, 7]]);
	});

	it("stops against the neighbour it runs into instead of overlapping it", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 4, 6));
		expect(spans(moveClip(lane, "b", 1, 10))).toEqual([
			["a", 0, 2],
			["b", 2, 4],
		]);
	});

	it("can't be dragged past the start or the end of the timeline", () => {
		expect(spans(moveClip(laneOf(clip("a", 1, 3)), "a", -5, 10))).toEqual([
			["a", 0, 2],
		]);
		expect(spans(moveClip(laneOf(clip("a", 1, 3)), "a", 99, 10))).toEqual([
			["a", 8, 10],
		]);
	});

	it("never reorders the lane, however far the drag goes", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 2, 4), clip("c", 4, 6));
		expect(spans(moveClip(lane, "b", -99, 10))).toEqual([
			["a", 0, 2],
			["b", 2, 4],
			["c", 4, 6],
		]);
	});

	it("pins a clip too long for the gap to the gap's start rather than inverting it", () => {
		// upper - length lands below lower here; the clamp has to survive that.
		const lane = laneOf(clip("a", 0, 1), clip("b", 1, 5), clip("c", 5, 6));
		expect(spans(moveClip(lane, "b", 99, 10))).toEqual([
			["a", 0, 1],
			["b", 1, 5],
			["c", 5, 6],
		]);
	});

	it("leaves the lane alone for an id it doesn't hold", () => {
		const lane = laneOf(clip("a", 0, 2));
		expect(moveClip(lane, "elsewhere", 5, 10)).toBe(lane);
	});
});

describe("moveClips", () => {
	it("slides the group as a block, keeping its internal spacing", () => {
		const lane = laneOf(clip("a", 0, 1), clip("b", 2, 3));
		expect(spans(moveClips(lane, ["a", "b"], 1, 10))).toEqual([
			["a", 1, 2],
			["b", 3, 4],
		]);
	});

	it("stops the whole group at the first unselected clip any member hits", () => {
		const lane = laneOf(clip("a", 0, 1), clip("b", 2, 3), clip("wall", 4, 5));
		// b can only travel 1s before it meets the wall, so a stops early too.
		expect(spans(moveClips(lane, ["a", "b"], 5, 10))).toEqual([
			["a", 1, 2],
			["b", 3, 4],
			["wall", 4, 5],
		]);
	});

	it("is bounded by the timeline at both ends", () => {
		const lane = laneOf(clip("a", 1, 2), clip("b", 3, 4));
		expect(spans(moveClips(lane, ["a", "b"], -99, 10))).toEqual([
			["a", 0, 1],
			["b", 2, 3],
		]);
		expect(spans(moveClips(lane, ["a", "b"], 99, 10))).toEqual([
			["a", 7, 8],
			["b", 9, 10],
		]);
	});

	it("ignores ids that belong to another lane", () => {
		const lane = laneOf(clip("a", 0, 1));
		expect(spans(moveClips(lane, ["a", "elsewhere"], 2, 10))).toEqual([
			["a", 2, 3],
		]);
	});

	it("leaves the lane alone when nothing selected is on it", () => {
		const lane = laneOf(clip("a", 0, 1));
		expect(moveClips(lane, ["elsewhere"], 2, 10)).toBe(lane);
		expect(moveClips(lane, [], 2, 10)).toBe(lane);
	});

	it("leaves the lane alone when the group is already boxed in", () => {
		const lane = laneOf(clip("a", 0, 5), clip("b", 5, 10));
		expect(moveClips(lane, ["a", "b"], 1, 10)).toBe(lane);
	});

	it("leaves the lane alone for a drag that resolves to no movement", () => {
		const lane = laneOf(clip("a", 0, 1));
		expect(moveClips(lane, ["a"], 0, 10)).toBe(lane);
	});
});

describe("resizeClip", () => {
	it("drags either edge to the requested time", () => {
		expect(
			spans(resizeClip(laneOf(clip("a", 2, 6)), "a", "start", 3, 10)),
		).toEqual([["a", 3, 6]]);
		expect(
			spans(resizeClip(laneOf(clip("a", 2, 6)), "a", "end", 5, 10)),
		).toEqual([["a", 2, 5]]);
	});

	it("never shrinks a clip below the minimum length", () => {
		const fromStart = resizeClip(laneOf(clip("a", 0, 4)), "a", "start", 99, 10);
		expect(spans(fromStart)).toEqual([["a", 4 - MIN_CLIP_LENGTH, 4]]);
		const fromEnd = resizeClip(laneOf(clip("a", 0, 4)), "a", "end", -99, 10);
		expect(spans(fromEnd)).toEqual([["a", 0, MIN_CLIP_LENGTH]]);
	});

	it("stops at the neighbour rather than swallowing it", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 4, 6));
		expect(spans(resizeClip(lane, "b", "start", 0, 10))).toEqual([
			["a", 0, 2],
			["b", 2, 6],
		]);
		expect(spans(resizeClip(lane, "a", "end", 99, 10))).toEqual([
			["a", 0, 4],
			["b", 4, 6],
		]);
	});

	it("opens a gap when one edge is pulled off a flush neighbour", () => {
		// Deliberately not resizeBoundary: dragging a single edge moves only that
		// edge, and the neighbour keeps its span.
		const lane = laneOf(clip("a", 0, 2), clip("b", 2, 4));
		expect(spans(resizeClip(lane, "b", "start", 3, 10))).toEqual([
			["a", 0, 2],
			["b", 3, 4],
		]);
	});

	it("clamps the trailing edge to the end of the timeline", () => {
		expect(
			spans(resizeClip(laneOf(clip("a", 0, 2)), "a", "end", 99, 10)),
		).toEqual([["a", 0, 10]]);
	});

	it("leaves the lane alone for an id it doesn't hold", () => {
		const lane = laneOf(clip("a", 0, 2));
		expect(resizeClip(lane, "elsewhere", "end", 5, 10)).toBe(lane);
	});
});

describe("resizeBoundary", () => {
	const lane = laneOf(clip("a", 0, 4), clip("b", 4, 8));

	it("moves both facing edges together, leaving no gap", () => {
		expect(spans(resizeBoundary(lane, "a", "b", 6))).toEqual([
			["a", 0, 6],
			["b", 6, 8],
		]);
	});

	it("keeps both clips above the minimum length", () => {
		expect(spans(resizeBoundary(lane, "a", "b", -99))).toEqual([
			["a", 0, MIN_CLIP_LENGTH],
			["b", MIN_CLIP_LENGTH, 8],
		]);
		expect(spans(resizeBoundary(lane, "a", "b", 99))).toEqual([
			["a", 0, 8 - MIN_CLIP_LENGTH],
			["b", 8 - MIN_CLIP_LENGTH, 8],
		]);
	});

	it("leaves the other clips on the lane where they are", () => {
		const three = laneOf(clip("a", 0, 4), clip("b", 4, 8), clip("c", 8, 9));
		expect(spans(resizeBoundary(three, "a", "b", 5))).toEqual([
			["a", 0, 5],
			["b", 5, 8],
			["c", 8, 9],
		]);
	});

	it("leaves the lane alone when either side is missing", () => {
		expect(resizeBoundary(lane, "a", "elsewhere", 5)).toBe(lane);
		expect(resizeBoundary(lane, "elsewhere", "b", 5)).toBe(lane);
	});
});

describe("addClip", () => {
	it("trims the new clip to the free span it lands in", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 6, 8));
		expect(spans(addClip(lane, clip("new", 3, 7), 10))).toEqual([
			["a", 0, 2],
			["new", 3, 6],
			["b", 6, 8],
		]);
	});

	it("picks the free span by where the clip starts, not where it overlaps", () => {
		// A clip whose start is already taken is refused outright, even though its
		// tail reaches open room.
		const lane = laneOf(clip("a", 0, 2), clip("b", 6, 8));
		expect(addClip(lane, clip("new", 1.5, 5), 10)).toBe(lane);
	});

	it("trims to the end of the timeline", () => {
		expect(spans(addClip(laneOf(), clip("new", 8, 20), 10))).toEqual([
			["new", 8, 10],
		]);
	});

	it("refuses to drop a clip on top of another", () => {
		const lane = laneOf(clip("a", 0, 4));
		expect(addClip(lane, clip("new", 1, 3), 10)).toBe(lane);
	});

	it("refuses a gap that would leave less than the minimum length", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 2 + MIN_CLIP_LENGTH / 2, 6));
		expect(addClip(lane, clip("new", 2, 3), 10)).toBe(lane);
	});

	it("refuses when the clip's own span is trimmed below the minimum", () => {
		// Room exists, but the requested span barely overlaps it.
		const lane = laneOf(clip("a", 0, 2));
		const sliver = clip("new", 2 - MIN_CLIP_LENGTH, 2 + MIN_CLIP_LENGTH / 2);
		expect(addClip(lane, sliver, 10)).toBe(lane);
	});
});

describe("removeClip", () => {
	it("drops the clip and leaves the rest", () => {
		const lane = laneOf(clip("a", 0, 1), clip("b", 2, 3));
		expect(spans(removeClip(lane, "a"))).toEqual([["b", 2, 3]]);
	});

	it("is a no-op for an unknown id", () => {
		const lane = laneOf(clip("a", 0, 1));
		expect(spans(removeClip(lane, "elsewhere"))).toEqual([["a", 0, 1]]);
	});
});

describe("updateLaneIn", () => {
	it("rebuilds only the lane that matched", () => {
		const lanes = [
			{ id: "one", clips: [clip("a", 0, 1)] },
			{ id: "two", clips: [clip("b", 0, 1)] },
		];
		const next = updateLaneIn(lanes, "two", (lane) => removeClip(lane, "b"));
		expect(next[0]).toBe(lanes[0]);
		expect(next[1].clips).toEqual([]);
	});

	it("leaves every lane alone when none matches", () => {
		const lanes = [{ id: "one", clips: [] }];
		expect(
			updateLaneIn(lanes, "missing", () => ({ id: "one", clips: [] }))[0],
		).toBe(lanes[0]);
	});
});

describe("clipFadeWeight", () => {
	const c = clip("a", 0, 10);

	it("is full strength across a clip with no fade", () => {
		expect(clipFadeWeight(c, undefined, 0)).toBe(1);
		expect(clipFadeWeight(c, 0, 5)).toBe(1);
	});

	it("ramps up from the head and down into the tail", () => {
		expect(clipFadeWeight(c, 2, 0)).toBe(0);
		expect(clipFadeWeight(c, 2, 1)).toBe(0.5);
		expect(clipFadeWeight(c, 2, 2)).toBe(1);
		expect(clipFadeWeight(c, 2, 9)).toBe(0.5);
		expect(clipFadeWeight(c, 2, 10)).toBe(0);
	});

	it("holds full strength between the two ramps", () => {
		expect(clipFadeWeight(c, 2, 5)).toBe(1);
	});

	it("caps an over-long fade at half the clip, peaking in the middle", () => {
		// A 20s fade on a 10s clip would otherwise have the ramps overlap and the
		// clip never reach full strength.
		expect(clipFadeWeight(c, 20, 5)).toBe(1);
		expect(clipFadeWeight(c, 20, 2.5)).toBe(0.5);
	});

	it("is zero outside the clip", () => {
		expect(clipFadeWeight(c, 2, -1)).toBe(0);
		expect(clipFadeWeight(c, 2, 11)).toBe(0);
	});

	it("is full strength on a clip too short to ramp", () => {
		expect(clipFadeWeight(clip("a", 5, 5), 1, 5)).toBe(1);
	});
});

describe("fitClipsToDuration", () => {
	it("returns the lane by identity when everything already fits", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 2, 4));
		expect(fitClipsToDuration(lane, 10)).toBe(lane);
	});

	it("trims the overhang off a clip that crosses the new end", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 4, 12));
		expect(spans(fitClipsToDuration(lane, 10))).toEqual([
			["a", 0, 2],
			["b", 4, 10],
		]);
	});

	it("drops a clip left entirely past the end", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 12, 14));
		expect(spans(fitClipsToDuration(lane, 10))).toEqual([["a", 0, 2]]);
	});

	it("drops a clip that would survive only as a sliver", () => {
		const lane = laneOf(clip("a", 10 - MIN_CLIP_LENGTH / 2, 14));
		expect(spans(fitClipsToDuration(lane, 10))).toEqual([]);
	});

	it("keeps a clip trimmed to exactly the minimum length", () => {
		const lane = laneOf(clip("a", 10 - MIN_CLIP_LENGTH, 14));
		expect(spans(fitClipsToDuration(lane, 10))).toEqual([
			["a", 10 - MIN_CLIP_LENGTH, 10],
		]);
	});

	it("leaves the lane alone while the duration is still unknown", () => {
		// Media metadata lands a tick after mount; a 0 here would wipe every clip.
		const lane = laneOf(clip("a", 0, 2));
		expect(fitClipsToDuration(lane, 0)).toBe(lane);
		expect(fitClipsToDuration(lane, -1)).toBe(lane);
	});
});
