import { describe, expect, it } from "bun:test";
import {
  addClip,
  clipAt,
  clipRange,
  freeRangeAt,
  moveClip,
  moveClips,
  removeClip,
  resizeBoundary,
  resizeClip,
  resolveTextLayersAt,
  sortClips,
} from "./resolve";
import {
  createTextClip,
  createTextLane,
  MIN_CLIP_LENGTH,
  normalizeTextTimeline,
  type TextLane,
  type TextTimeline,
} from "./types";

function laneWith(spans: [number, number][], text = "hi"): TextLane {
  const lane = createTextLane("Text 1");
  return {
    ...lane,
    clips: spans.map(([s, e]) => createTextClip(s, e, text)),
  };
}

function timelineOf(lanes: TextLane[]): TextTimeline {
  return { enabled: true, lanes };
}

describe("clipAt", () => {
  it("treats clips as half-open so touching clips never both match", () => {
    const lane = laneWith([
      [0, 1],
      [1, 2],
    ]);
    expect(clipAt(lane, 0)?.id).toBe(lane.clips[0].id);
    expect(clipAt(lane, 1)?.id).toBe(lane.clips[1].id);
    expect(clipAt(lane, 2)).toBeNull();
  });
});

describe("resolveTextLayersAt", () => {
  it("returns nothing when the timeline is off", () => {
    const t = { ...timelineOf([laneWith([[0, 5]])]), enabled: false };
    expect(resolveTextLayersAt(t, 1)).toEqual([]);
  });

  it("skips disabled lanes, blank text and fully transparent clips", () => {
    const visible = laneWith([[0, 5]]);
    const disabled = { ...laneWith([[0, 5]]), enabled: false };
    const blank = laneWith([[0, 5]], "   ");
    const clear = laneWith([[0, 5]]);
    clear.style = { ...clear.style, opacity: 0 };

    const layers = resolveTextLayersAt(
      timelineOf([visible, disabled, blank, clear]),
      1,
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].laneId).toBe(visible.id);
  });

  it("carries one layer per lane in lane order", () => {
    const a = laneWith([[0, 5]], "a");
    const b = laneWith([[0, 5]], "b");
    const layers = resolveTextLayersAt(timelineOf([a, b]), 2);
    expect(layers.map((l) => l.text)).toEqual(["a", "b"]);
  });
});

describe("freeRangeAt", () => {
  it("bounds the gap by its neighbours", () => {
    const lane = laneWith([
      [0, 2],
      [5, 8],
    ]);
    expect(freeRangeAt(lane, 3, 10)).toEqual({ start: 2, end: 5 });
  });

  it("returns null on top of a clip", () => {
    expect(freeRangeAt(laneWith([[0, 2]]), 1, 10)).toBeNull();
  });

  it("returns null when the gap is too short to hold a clip", () => {
    const lane = laneWith([
      [0, 2],
      [2 + MIN_CLIP_LENGTH / 2, 5],
    ]);
    expect(freeRangeAt(lane, 2.01, 10)).toBeNull();
  });
});

describe("moveClip", () => {
  it("keeps the clip length", () => {
    const lane = laneWith([[1, 3]]);
    const moved = moveClip(lane, lane.clips[0].id, 5, 10);
    expect(moved.clips[0]).toMatchObject({ start: 5, end: 7 });
  });

  it("stops at the previous clip instead of overlapping it", () => {
    const lane = laneWith([
      [0, 2],
      [4, 6],
    ]);
    const moved = moveClip(lane, lane.clips[1].id, 0.5, 10);
    expect(moved.clips[1]).toMatchObject({ start: 2, end: 4 });
  });

  it("stops at the next clip", () => {
    const lane = laneWith([
      [0, 2],
      [4, 6],
    ]);
    const moved = moveClip(lane, lane.clips[0].id, 9, 10);
    expect(moved.clips[0]).toMatchObject({ start: 2, end: 4 });
  });

  it("clamps to the timeline bounds", () => {
    const lane = laneWith([[1, 3]]);
    expect(moveClip(lane, lane.clips[0].id, -5, 10).clips[0].start).toBe(0);
    expect(moveClip(lane, lane.clips[0].id, 99, 10).clips[0].end).toBe(10);
  });
});

describe("resizeClip", () => {
  it("never lets an edge cross its own clip", () => {
    const lane = laneWith([[2, 4]]);
    const a = resizeClip(lane, lane.clips[0].id, "start", 9, 10);
    expect(a.clips[0].start).toBeCloseTo(4 - MIN_CLIP_LENGTH);
    const b = resizeClip(lane, lane.clips[0].id, "end", 0, 10);
    expect(b.clips[0].end).toBeCloseTo(2 + MIN_CLIP_LENGTH);
  });

  it("stops at a neighbour", () => {
    const lane = laneWith([
      [0, 2],
      [4, 6],
    ]);
    const resized = resizeClip(lane, lane.clips[1].id, "start", 1, 10);
    expect(resized.clips[1].start).toBe(2);
  });

  it("clamps the end to the duration", () => {
    const lane = laneWith([[0, 2]]);
    expect(resizeClip(lane, lane.clips[0].id, "end", 99, 10).clips[0].end).toBe(
      10,
    );
  });

  it("lets a flush edge disconnect from its neighbour", () => {
    const lane = laneWith([
      [0, 2],
      [2, 4],
    ]);
    const resized = resizeClip(lane, lane.clips[0].id, "end", 1.5, 10);
    expect(resized.clips[0].end).toBe(1.5);
    expect(resized.clips[1].start).toBe(2);
  });

  it("resizes a free edge without touching its neighbours", () => {
    const lane = laneWith([
      [0, 2],
      [4, 6],
    ]);
    const resized = resizeClip(lane, lane.clips[0].id, "end", 3, 10);
    expect(resized.clips[0].end).toBe(3);
    expect(resized.clips[1].start).toBe(4);
  });
});

describe("resizeBoundary", () => {
  it("moves both clips' facing edges together", () => {
    const lane = laneWith([
      [0, 2],
      [2, 4],
      [6, 8],
    ]);
    const resized = resizeBoundary(
      lane,
      lane.clips[0].id,
      lane.clips[1].id,
      2.5,
    );
    expect(resized.clips[0].end).toBe(2.5);
    expect(resized.clips[1].start).toBe(2.5);
    expect(resized.clips[2].start).toBe(6);
  });

  it("keeps both clips above the minimum length", () => {
    const lane = laneWith([
      [0, 2],
      [2, 4],
    ]);
    const resized = resizeBoundary(
      lane,
      lane.clips[0].id,
      lane.clips[1].id,
      3.99,
    );
    expect(resized.clips[0].end).toBeCloseTo(4 - MIN_CLIP_LENGTH);
    expect(resized.clips[1].start).toBeCloseTo(4 - MIN_CLIP_LENGTH);
  });
});

describe("addClip", () => {
  it("trims the new clip to the end of the free span it lands in", () => {
    const lane = laneWith([
      [0, 2],
      [5, 8],
    ]);
    const added = addClip(lane, createTextClip(3, 6, "x"), 10);
    expect(added.clips[1]).toMatchObject({ start: 3, end: 5 });
  });

  it("refuses to add on top of an existing clip", () => {
    const lane = laneWith([[0, 5]]);
    expect(addClip(lane, createTextClip(1, 2, "x"), 10).clips).toHaveLength(1);
  });

  it("keeps clips sorted by start", () => {
    let lane = laneWith([[5, 8]]);
    lane = addClip(lane, createTextClip(0, 2, "x"), 10);
    expect(lane.clips.map((c) => c.start)).toEqual([0, 5]);
  });
});

describe("removeClip", () => {
  it("drops only the named clip", () => {
    const lane = laneWith([
      [0, 2],
      [4, 6],
    ]);
    expect(removeClip(lane, lane.clips[0].id).clips).toHaveLength(1);
  });
});

describe("normalizeTextTimeline", () => {
  it("survives junk and fills in defaults", () => {
    expect(normalizeTextTimeline(null).lanes).toEqual([]);
    const t = normalizeTextTimeline({
      enabled: true,
      lanes: [{ clips: [{ start: 0, end: 1 }] }],
    });
    expect(t.lanes[0].enabled).toBe(true);
    expect(t.lanes[0].chainIndex).toBe(Number.MAX_SAFE_INTEGER);
    expect(t.lanes[0].style.color).toBe("#ffffff");
    expect(t.lanes[0].effects).toEqual([]);
  });

  it("lifts a legacy per-clip style onto the lane", () => {
    const t = normalizeTextTimeline({
      enabled: true,
      lanes: [
        {
          clips: [
            { start: 0, end: 1, style: { color: "#ff0000", y: 0.7 } },
            { start: 1, end: 2, style: { color: "#00ff00" } },
          ],
        },
      ],
    });
    expect(t.lanes[0].style.color).toBe("#ff0000");
    expect(t.lanes[0].style.y).toBe(0.7);
    expect(t.lanes[0].clips[0]).not.toHaveProperty("style");
  });
});

describe("clipRange", () => {
  it("covers everything between the two ends, inclusive", () => {
    const lane = laneWith([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    const ids = lane.clips.map((c) => c.id);
    expect(clipRange(lane, ids[0], ids[2])).toEqual([ids[0], ids[1], ids[2]]);
  });

  it("reads the same range dragged backwards", () => {
    const lane = laneWith([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    const ids = lane.clips.map((c) => c.id);
    expect(clipRange(lane, ids[2], ids[0])).toEqual(clipRange(lane, ids[0], ids[2]));
  });

  it("orders by time, not by position in the lane's array", () => {
    const lane = laneWith([
      [4, 5],
      [0, 1],
      [2, 3],
    ]);
    const byTime = sortClips(lane.clips).map((c) => c.id);
    expect(clipRange(lane, byTime[0], byTime[2])).toEqual(byTime);
  });

  it("falls back to the clicked clip when the anchor is elsewhere", () => {
    const lane = laneWith([[0, 1]]);
    expect(clipRange(lane, "not-in-this-lane", lane.clips[0].id)).toEqual([
      lane.clips[0].id,
    ]);
  });

  it("is empty when the target isn't in the lane", () => {
    const lane = laneWith([[0, 1]]);
    expect(clipRange(lane, lane.clips[0].id, "nope")).toEqual([]);
  });
});

describe("moveClips", () => {
  it("slides the group, keeping the spacing inside it", () => {
    const lane = laneWith([
      [0, 1],
      [2, 3],
      [8, 9],
    ]);
    const ids = [lane.clips[0].id, lane.clips[1].id];
    const moved = moveClips(lane, ids, 1, 20);
    expect(moved.clips.map((c) => [c.start, c.end])).toEqual([
      [1, 2],
      [3, 4],
      [8, 9],
    ]);
  });

  it("stops the whole group at the first unselected neighbour", () => {
    const lane = laneWith([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    // Moving the first two right can only close the 1s gap before the third.
    const ids = [lane.clips[0].id, lane.clips[1].id];
    const moved = moveClips(lane, ids, 10, 20);
    expect(moved.clips.map((c) => [c.start, c.end])).toEqual([
      [1, 2],
      [3, 4],
      [4, 5],
    ]);
  });

  it("stops at the track ends", () => {
    const lane = laneWith([
      [1, 2],
      [3, 4],
    ]);
    const ids = lane.clips.map((c) => c.id);
    expect(moveClips(lane, ids, -10, 10).clips.map((c) => c.start)).toEqual([0, 2]);
    expect(moveClips(lane, ids, 10, 10).clips.map((c) => c.end)).toEqual([8, 10]);
  });

  it("never lets a moved clip overlap a fixed one", () => {
    const lane = laneWith([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
    const moved = moveClips(lane, [lane.clips[1].id], -5, 10);
    const ordered = sortClips(moved.clips);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].start).toBeGreaterThanOrEqual(ordered[i - 1].end);
    }
  });

  it("ignores ids from other lanes", () => {
    const lane = laneWith([[0, 1]]);
    const before = lane.clips.map((c) => c.start);
    expect(moveClips(lane, ["elsewhere"], 5, 10).clips.map((c) => c.start)).toEqual(
      before,
    );
  });

  it("leaves a boxed-in group alone", () => {
    const lane = laneWith([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    const moved = moveClips(lane, [lane.clips[1].id], 5, 3);
    expect(moved.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });
});
