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
	moveClipsToLane,
	newClipSpan,
	placeClipBlock,
	removeClip,
	retargetClipBlock,
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

describe("newClipSpan", () => {
	it("starts under the pointer and runs for the length asked for", () => {
		expect(newClipSpan(laneOf(), 3, 10, 2)).toEqual({ start: 3, end: 5 });
	});

	it("keeps its length and backs up off the next clip", () => {
		// Not truncated where it was aimed: the same bargain moveClip strikes, so
		// a dropped clip and a dragged one come to rest the same way.
		const lane = laneOf(clip("a", 4, 8));
		expect(newClipSpan(lane, 3, 10, 2)).toEqual({ start: 2, end: 4 });
	});

	it("backs up off the end of the timeline", () => {
		expect(newClipSpan(laneOf(), 9, 10, 5)).toEqual({ start: 5, end: 10 });
	});

	it("lands flush against a neighbour when aimed at the last sliver of a gap", () => {
		// Dropping nothing there would read as the gesture having missed.
		const lane = laneOf(clip("a", 0, 2), clip("b", 4, 6));
		expect(newClipSpan(lane, 3.99, 10, 2)).toEqual({ start: 2, end: 4 });
	});

	it("is trimmed only by a gap shorter than the clip itself", () => {
		const lane = laneOf(clip("a", 0, 2), clip("b", 3, 6));
		expect(newClipSpan(lane, 2.2, 10, 5)).toEqual({ start: 2, end: 3 });
	});

	it("never starts before the gap does", () => {
		const lane = laneOf(clip("a", 0, 5));
		// A pointer time behind the gap's start can't drag the clip under its
		// neighbour — freeRangeAt bounds it either way.
		expect(newClipSpan(lane, 5, 10, 2)).toEqual({ start: 5, end: 7 });
	});

	it("widens a length shorter than the minimum", () => {
		const span = newClipSpan(laneOf(), 1, 10, MIN_CLIP_LENGTH / 4)!;
		expect(span.end - span.start).toBeCloseTo(MIN_CLIP_LENGTH, 10);
	});

	it("is null on an occupied time", () => {
		expect(newClipSpan(laneOf(clip("a", 0, 5)), 2, 10, 2)).toBeNull();
	});

	it("is null where the gap is too short to hold anything", () => {
		const tight = laneOf(clip("a", 0, 1), clip("b", 1 + MIN_CLIP_LENGTH / 2, 4));
		expect(newClipSpan(tight, 1, 10, 2)).toBeNull();
	});

	it("takes the whole gap when the pointer is pinned against its tail", () => {
		// MIN_CLIP_LENGTH has no exact binary form, so a span derived by
		// subtracting it off the gap's end and adding it back used to land a
		// rounding step under it — which addClip refused, making the drop preview
		// a clip and then do nothing.
		const lane = laneOf(clip("a", 0, 2), clip("b", 4, 6));
		const span = newClipSpan(lane, 4 - MIN_CLIP_LENGTH, 10, 2)!;
		expect(span.end).toBe(4);
		expect(addClip(lane, { id: "new", ...span }, 10).clips).toHaveLength(3);
	});

	it("always yields a span addClip will accept", () => {
		// The two have to agree: a ghost drawn for a span addClip then refuses is
		// a drop that previews and does nothing. Swept rather than sampled —
		// the failure was a floating-point edge no hand-picked case found.
		const lane = laneOf(clip("a", 0, 2), clip("b", 4, 6));
		for (let step = 0; step <= 400; step++) {
			const t = 2 + (step / 400) * 2;
			for (const want of [MIN_CLIP_LENGTH / 3, 0.1, 1, 2, 30]) {
				const span = newClipSpan(lane, t, 10, want);
				if (!span) continue;
				expect(addClip(lane, { id: "new", ...span }, 10).clips).toHaveLength(
					3,
				);
				expect(span.start).toBeGreaterThanOrEqual(2);
				expect(span.end).toBeLessThanOrEqual(4);
			}
		}
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

describe("moveClipsToLane", () => {
	const idLane = (id: string, ...clips: TimelineClip[]) => ({ id, clips });

	it("carries the group over, shifted, when it lands clear", () => {
		const lanes = [
			idLane("x", clip("a", 0, 1), clip("b", 2, 3)),
			idLane("y", clip("c", 0, 1)),
		];
		const next = moveClipsToLane(lanes, "x", "y", ["a", "b"], 2, 10);
		expect(spans(next[0])).toEqual([]);
		expect(spans(next[1])).toEqual([
			["c", 0, 1],
			["a", 2, 3],
			["b", 4, 5],
		]);
	});

	it("stays put when any member would overlap the target's clips", () => {
		const lanes = [
			idLane("x", clip("a", 0, 1), clip("b", 2, 3)),
			idLane("y", clip("c", 4, 5)),
		];
		expect(moveClipsToLane(lanes, "x", "y", ["a", "b"], 2, 10)).toBe(lanes);
	});

	it("stays put when the shift runs off the timeline", () => {
		const lanes = [idLane("x", clip("a", 0, 1)), idLane("y")];
		expect(moveClipsToLane(lanes, "x", "y", ["a"], -0.5, 10)).toBe(lanes);
		expect(moveClipsToLane(lanes, "x", "y", ["a"], 9.5, 10)).toBe(lanes);
	});

	it("ignores ids that aren't on the source lane, and same-lane moves", () => {
		const lanes = [idLane("x", clip("a", 0, 1)), idLane("y", clip("c", 4, 5))];
		expect(moveClipsToLane(lanes, "x", "y", ["c"], 1, 10)).toBe(lanes);
		expect(moveClipsToLane(lanes, "x", "x", ["a"], 1, 10)).toBe(lanes);
	});

	it("lets the caller rewrite clips for the lane they land on", () => {
		const lanes = [idLane("x", clip("a", 0, 1)), idLane("y")];
		const next = moveClipsToLane(
			lanes,
			"x",
			"y",
			["a"],
			0,
			10,
			(c, from, to) => ({
				...c,
				id: `${c.id}:${from.id}>${to.id}`,
			}),
		);
		expect(spans(next[1])).toEqual([["a:x>y", 0, 1]]);
	});
});

describe("placeClipBlock", () => {
	const entry = (laneId: string, offset: number, length: number) => ({
		laneId,
		offset,
		length,
	});
	const lanesOf = (...lanes: (ClipLane<TimelineClip> & { id: string })[]) =>
		new Map(lanes.map((l) => [l.id, l]));
	const spansOf = (placed: { start: number; end: number }[]) =>
		placed.map((p) => [p.start, p.end]);

	it("keeps the block whole, sliding right past what is in the way", () => {
		const lanes = lanesOf({ id: "x", clips: [clip("a", 0, 4)] });
		const placed = placeClipBlock(
			[entry("x", 0, 2), entry("x", 3, 1)],
			lanes,
			2,
			20,
		);
		expect(spansOf(placed)).toEqual([
			[4, 6],
			[7, 8],
		]);
	});

	it("trims to the gap at the anchor when nothing fits at full length", () => {
		const lanes = lanesOf({
			id: "x",
			clips: [clip("a", 0, 4), clip("b", 7, 10)],
		});
		const placed = placeClipBlock([entry("x", 0, 5)], lanes, 5, 10);
		expect(spansOf(placed)).toEqual([[5, 7]]);
	});

	it("moves a trimmed clip past the clip covering its spot", () => {
		const lanes = lanesOf({
			id: "x",
			clips: [clip("a", 0, 4), clip("b", 6, 10)],
		});
		const placed = placeClipBlock([entry("x", 0, 8)], lanes, 2, 10);
		expect(spansOf(placed)).toEqual([[4, 6]]);
	});

	it("lets earlier entries take their room before later ones", () => {
		const lanes = lanesOf({ id: "x", clips: [clip("a", 6, 10)] });
		const placed = placeClipBlock(
			[entry("x", 0, 5), entry("x", 5, 5)],
			lanes,
			0,
			10,
		);
		// The second entry gets what is left between the first and the clip.
		expect(spansOf(placed)).toEqual([
			[0, 5],
			[5, 6],
		]);
	});

	it("drops entries with no room and ones on missing lanes", () => {
		const lanes = lanesOf({ id: "x", clips: [clip("a", 0, 10)] });
		expect(
			placeClipBlock([entry("x", 0, 2), entry("gone", 0, 2)], lanes, 0, 10),
		).toEqual([]);
	});
});

describe("retargetClipBlock", () => {
	const laneIds = ["a", "b", "c"];
	const e = (laneId: string) => ({ laneId, offset: 0, length: 1 });

	it("moves the block so its first lane is the target, keeping spacing", () => {
		const out = retargetClipBlock([e("a"), e("b")], laneIds, "b");
		expect(out.map((x) => x.laneId)).toEqual(["b", "c"]);
	});

	it("drops entries pushed past the last lane", () => {
		const out = retargetClipBlock([e("a"), e("b")], laneIds, "c");
		expect(out.map((x) => x.laneId)).toEqual(["c"]);
	});

	it("is the input when the target is unknown, absent, or already first", () => {
		const entries = [e("a")];
		expect(retargetClipBlock(entries, laneIds, "mosh")).toBe(entries);
		expect(retargetClipBlock(entries, laneIds, null)).toBe(entries);
		expect(retargetClipBlock(entries, laneIds, "a")).toBe(entries);
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
		expect(clipFadeWeight(c, undefined, undefined, 0)).toBe(1);
		expect(clipFadeWeight(c, 0, 0, 5)).toBe(1);
	});

	it("ramps up from the head and down into the tail", () => {
		expect(clipFadeWeight(c, 2, 2, 0)).toBe(0);
		expect(clipFadeWeight(c, 2, 2, 1)).toBe(0.5);
		expect(clipFadeWeight(c, 2, 2, 2)).toBe(1);
		expect(clipFadeWeight(c, 2, 2, 9)).toBe(0.5);
		expect(clipFadeWeight(c, 2, 2, 10)).toBe(0);
	});

	it("ramps each edge on its own", () => {
		expect(clipFadeWeight(c, 2, undefined, 1)).toBe(0.5);
		expect(clipFadeWeight(c, 2, undefined, 10)).toBe(1);
		expect(clipFadeWeight(c, undefined, 4, 0)).toBe(1);
		expect(clipFadeWeight(c, undefined, 4, 8)).toBe(0.5);
	});

	it("holds full strength between the two ramps", () => {
		expect(clipFadeWeight(c, 2, 2, 5)).toBe(1);
	});

	it("shrinks over-long fades in proportion so they meet", () => {
		// 20s each on a 10s clip would otherwise overlap and never reach full.
		expect(clipFadeWeight(c, 20, 20, 5)).toBe(1);
		expect(clipFadeWeight(c, 20, 20, 2.5)).toBe(0.5);
		// 30s in + 10s out on 10s meet at 7.5.
		expect(clipFadeWeight(c, 30, 10, 7.5)).toBe(1);
		expect(clipFadeWeight(c, 30, 10, 3.75)).toBe(0.5);
	});

	it("is zero outside the clip", () => {
		expect(clipFadeWeight(c, 2, 2, -1)).toBe(0);
		expect(clipFadeWeight(c, 2, 2, 11)).toBe(0);
	});

	it("is full strength on a clip too short to ramp", () => {
		expect(clipFadeWeight(clip("a", 5, 5), 1, 1, 5)).toBe(1);
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
