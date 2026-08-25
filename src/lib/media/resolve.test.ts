import { describe, expect, it } from "bun:test";
import {
  detachMediaSource,
  mediaTimelineSourceIds,
  resolveMediaLayersAt,
} from "./resolve";
import {
  createFullSpanLane,
  createMediaClip,
  createMediaLane,
  normalizeMediaTimeline,
  splitMediaClipAt,
  type MediaLane,
  type MediaTimeline,
} from "./types";

function laneWith(spans: [number, number, number?][]): MediaLane {
  const lane = createMediaLane("Layer 1", "src-a");
  return {
    ...lane,
    clips: spans.map(([s, e, into]) => createMediaClip(s, e, into ?? 0)),
  };
}

function timelineOf(lanes: MediaLane[]): MediaTimeline {
  return { enabled: true, lanes };
}

describe("resolveMediaLayersAt", () => {
  it("walks the source forward with the clip", () => {
    const t = timelineOf([laneWith([[2, 6]])]);
    expect(resolveMediaLayersAt(t, 2)?.[0].sourceTime).toBe(0);
    expect(resolveMediaLayersAt(t, 4.5)?.[0].sourceTime).toBe(2.5);
  });

  it("offsets by the clip's in-point", () => {
    const t = timelineOf([laneWith([[0, 4, 10]])]);
    expect(resolveMediaLayersAt(t, 1)?.[0].sourceTime).toBe(11);
  });

  it("keys by lane, not by clip, so a cut doesn't drop the texture", () => {
    const lane = laneWith([
      [0, 1],
      [1, 2],
    ]);
    const t = timelineOf([lane]);
    expect(resolveMediaLayersAt(t, 0.5)[0].key).toBe(
      resolveMediaLayersAt(t, 1.5)[0].key,
    );
    expect(resolveMediaLayersAt(t, 0.5)[0].key).toBe(lane.id);
  });

  it("skips lanes with nothing to draw", () => {
    const noSource: MediaLane = { ...laneWith([[0, 4]]), sourceId: null };
    const hidden: MediaLane = { ...laneWith([[0, 4]]), enabled: false };
    const clear: MediaLane = {
      ...laneWith([[0, 4]]),
      style: { ...laneWith([[0, 4]]).style, opacity: 0 },
    };
    expect(resolveMediaLayersAt(timelineOf([noSource]), 1)).toHaveLength(0);
    expect(resolveMediaLayersAt(timelineOf([hidden]), 1)).toHaveLength(0);
    expect(resolveMediaLayersAt(timelineOf([clear]), 1)).toHaveLength(0);
  });

  it("resolves nothing while the timeline is off", () => {
    const t = { ...timelineOf([laneWith([[0, 4]])]), enabled: false };
    expect(resolveMediaLayersAt(t, 1)).toHaveLength(0);
    expect(resolveMediaLayersAt(null, 1)).toHaveLength(0);
  });
});

describe("splitMediaClipAt", () => {
  it("carries the source position across the cut", () => {
    const lane = laneWith([[0, 4, 5]]);
    const split = splitMediaClipAt(lane, 3);
    expect(split.clips.map((c) => [c.start, c.end, c.sourceStart])).toEqual([
      [0, 3, 5],
      [3, 4, 8],
    ]);
  });

  it("leaves the lane alone when a half would be too short", () => {
    const lane = laneWith([[0, 4]]);
    expect(splitMediaClipAt(lane, 0.001)).toBe(lane);
    expect(splitMediaClipAt(lane, 9)).toBe(lane);
  });
});

describe("createFullSpanLane", () => {
  it("arrives visible for the whole timeline", () => {
    const lane = createFullSpanLane("Layer 1", "src-a", 12);
    expect(lane.clips).toHaveLength(1);
    expect(lane.clips[0].end).toBe(12);
  });
});

describe("detachMediaSource", () => {
  it("clears only the lanes that pointed at the removed media", () => {
    const a = laneWith([[0, 2]]);
    const b: MediaLane = { ...laneWith([[0, 2]]), sourceId: "src-b" };
    const next = detachMediaSource(timelineOf([a, b]), "src-a");
    expect(next.lanes[0].sourceId).toBeNull();
    expect(next.lanes[1].sourceId).toBe("src-b");
  });

  it("returns the same timeline when nothing referenced it", () => {
    const t = timelineOf([laneWith([[0, 2]])]);
    expect(detachMediaSource(t, "src-z")).toBe(t);
  });
});

describe("mediaTimelineSourceIds", () => {
  it("lists each referenced source once", () => {
    const a = laneWith([[0, 2]]);
    const b = laneWith([[0, 2]]);
    const c: MediaLane = { ...laneWith([[0, 2]]), sourceId: "src-b" };
    expect(mediaTimelineSourceIds(timelineOf([a, b, c]))).toEqual([
      "src-a",
      "src-b",
    ]);
  });
});

describe("normalizeMediaTimeline", () => {
  it("fills in what a saved timeline predates", () => {
    const t = normalizeMediaTimeline({
      enabled: true,
      lanes: [{ clips: [{ start: 0, end: 2 }] }],
    });
    expect(t.lanes[0].sourceId).toBeNull();
    expect(t.lanes[0].enabled).toBe(true);
    expect(t.lanes[0].style.scale).toBe(1);
    expect(t.lanes[0].clips[0].sourceStart).toBe(0);
    expect(t.lanes[0].effects).toEqual([]);
  });

  it("survives junk", () => {
    expect(normalizeMediaTimeline(null).lanes).toHaveLength(0);
    expect(normalizeMediaTimeline("nope").enabled).toBe(false);
  });
});
