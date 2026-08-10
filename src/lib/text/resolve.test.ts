import { describe, expect, it } from "bun:test";
import {
  addClip,
  clipAt,
  freeRangeAt,
  moveClip,
  removeClip,
  resizeClip,
  resolveTextLayersAt,
  snapTime,
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
    clear.clips[0].style = { ...clear.clips[0].style, opacity: 0 };

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

describe("snapTime", () => {
  it("rounds to the grid, and passes through when there is none", () => {
    expect(snapTime(1.3, 0.5)).toBe(1.5);
    expect(snapTime(1.3, 0)).toBe(1.3);
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
    expect(t.lanes[0].clips[0].style.color).toBe("#ffffff");
    expect(t.lanes[0].clips[0].effects).toEqual([]);
  });
});
