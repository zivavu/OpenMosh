import { describe, expect, it } from "bun:test";
import {
  clipSourceId,
  detachMediaSource,
  laneSourceIds,
  mediaTimelineSourceIds,
  resolveMediaLayersAt,
  setMediaClipSources,
} from "./resolve";
import {
  createFullSpanLane,
  createMediaClip,
  createMediaLane,
  fitMediaTimeline,
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

/** Point the clip at `index` at its own source. */
function retargeted(lane: MediaLane, index: number, sourceId: string): MediaLane {
  return {
    ...lane,
    clips: lane.clips.map((c, i) => (i === index ? { ...c, sourceId } : c)),
  };
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

  it("carries the lane's opacity through unfaded", () => {
    const t = timelineOf([laneWith([[0, 4]])]);
    expect(resolveMediaLayersAt(t, 1)[0].opacity).toBe(1);
  });

  it("ramps opacity across a clip's fade", () => {
    const lane = laneWith([[0, 10]]);
    const faded: MediaLane = {
      ...lane,
      style: { ...lane.style, opacity: 0.5 },
      clips: [{ ...lane.clips[0], fadeSec: 2 }],
    };
    const at = (time: number) =>
      resolveMediaLayersAt(timelineOf([faded]), time)[0].opacity;
    expect(at(0)).toBe(0);
    expect(at(1)).toBeCloseTo(0.25, 5);
    expect(at(5)).toBe(0.5);
    expect(at(9)).toBeCloseTo(0.25, 5);
  });

  it("keeps the fade through a split and a save round-trip", () => {
    const lane = laneWith([[0, 10]]);
    const faded: MediaLane = {
      ...lane,
      clips: [{ ...lane.clips[0], fadeSec: 0.5 }],
    };
    const split = splitMediaClipAt(faded, 5);
    expect(split.clips.map((c) => c.fadeSec)).toEqual([0.5, 0.5]);
    const saved = normalizeMediaTimeline(
      JSON.parse(JSON.stringify(timelineOf([faded]))),
    );
    expect(saved.lanes[0].clips[0].fadeSec).toBe(0.5);
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

  it("starts with the same switches the main chain has, all off", () => {
    const lane = createFullSpanLane("Layer 1", "src-a", 12);
    expect(lane.effects.length).toBeGreaterThan(0);
    expect(lane.effects.every((e) => !e.enabled)).toBe(true);
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

  it("counts what a retargeted clip draws, not just its lane", () => {
    const lane = retargeted(
      laneWith([
        [0, 2],
        [2, 4],
      ]),
      1,
      "src-c",
    );
    expect(mediaTimelineSourceIds(timelineOf([lane]))).toEqual([
      "src-a",
      "src-c",
    ]);
  });
});

describe("per-clip sources", () => {
  it("falls back to the lane until a clip picks its own", () => {
    const lane = laneWith([
      [0, 2],
      [2, 4],
    ]);
    expect(clipSourceId(lane, lane.clips[0])).toBe("src-a");
    const next = retargeted(lane, 1, "src-b");
    expect(clipSourceId(next, next.clips[0])).toBe("src-a");
    expect(clipSourceId(next, next.clips[1])).toBe("src-b");
  });

  it("draws each half of a split from its own source", () => {
    const lane = retargeted(
      laneWith([
        [0, 2],
        [2, 4],
      ]),
      1,
      "src-b",
    );
    const t = timelineOf([lane]);
    expect(resolveMediaLayersAt(t, 1)[0].sourceId).toBe("src-a");
    expect(resolveMediaLayersAt(t, 3)[0].sourceId).toBe("src-b");
    // Same lane, so the layer keeps one texture and one effect chain.
    expect(resolveMediaLayersAt(t, 3)[0].key).toBe(lane.id);
  });

  it("still draws a clip whose lane has no source of its own", () => {
    const lane: MediaLane = {
      ...retargeted(laneWith([[0, 2]]), 0, "src-b"),
      sourceId: null,
    };
    const layers = resolveMediaLayersAt(timelineOf([lane]), 1);
    expect(layers).toHaveLength(1);
    expect(layers[0].sourceId).toBe("src-b");
  });

  it("keeps both halves on the source the clip was split from", () => {
    const lane = retargeted(laneWith([[0, 4]]), 0, "src-b");
    const split = splitMediaClipAt(lane, 2);
    expect(split.clips.map((c) => c.sourceId)).toEqual(["src-b", "src-b"]);
  });

  it("lists every source a lane can call for", () => {
    const lane = retargeted(
      laneWith([
        [0, 2],
        [2, 4],
      ]),
      1,
      "src-b",
    );
    expect(laneSourceIds(lane).sort()).toEqual(["src-a", "src-b"]);
  });

  it("hands a clip back to its lane when they name the same source", () => {
    const lane = retargeted(laneWith([[0, 2]]), 0, "src-b");
    const next = setMediaClipSources(
      timelineOf([lane]),
      [lane.clips[0].id],
      "src-a",
    );
    expect(next.lanes[0].clips[0].sourceId).toBeUndefined();
  });

  it("drops a removed source from clips as well as lanes", () => {
    const lane = retargeted(laneWith([[0, 2]]), 0, "src-b");
    const next = detachMediaSource(timelineOf([lane]), "src-b");
    expect(next.lanes[0].clips[0].sourceId).toBeUndefined();
    expect(next.lanes[0].sourceId).toBe("src-a");
  });

  it("carries a clip's own source through a save", () => {
    const lane = retargeted(laneWith([[0, 2]]), 0, "src-b");
    const round = normalizeMediaTimeline(
      JSON.parse(JSON.stringify(timelineOf([lane]))),
    );
    expect(round.lanes[0].clips[0].sourceId).toBe("src-b");
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
    // Backfilled rather than left empty: a lane with no chain gives its panel
    // nothing to switch on.
    expect(t.lanes[0].effects.length).toBeGreaterThan(0);
    expect(t.lanes[0].effects.every((e) => !e.enabled)).toBe(true);
  });

  it("backfills bleed on a layer saved before it existed", () => {
    const t = normalizeMediaTimeline({
      enabled: true,
      lanes: [{ style: { scale: 2 }, clips: [{ start: 0, end: 2 }] }],
    });
    expect(t.lanes[0].style.bleed).toBe(0.25);
    expect(t.lanes[0].style.bleedFade).toBe(0.5);
    expect(t.lanes[0].style.scale).toBe(2);
  });

  it("survives junk", () => {
    expect(normalizeMediaTimeline(null).lanes).toHaveLength(0);
    expect(normalizeMediaTimeline("nope").enabled).toBe(false);
  });
});

describe("fitMediaTimeline", () => {
  it("trims a clip left hanging past a shorter track", () => {
    const t = timelineOf([laneWith([[0, 120]])]);
    const fitted = fitMediaTimeline(t, 90);
    expect(fitted.lanes[0].clips[0].end).toBe(90);
    expect(fitted.lanes[0].clips[0].start).toBe(0);
  });

  it("drops clips that fall off the end entirely", () => {
    const t = timelineOf([
      laneWith([
        [0, 30],
        [100, 120],
      ]),
    ]);
    const fitted = fitMediaTimeline(t, 90);
    expect(fitted.lanes[0].clips).toHaveLength(1);
    expect(fitted.lanes[0].clips[0].end).toBe(30);
  });

  it("drops a clip that would be left shorter than the minimum", () => {
    const t = timelineOf([laneWith([[89.99, 120]])]);
    expect(fitMediaTimeline(t, 90).lanes[0].clips).toHaveLength(0);
  });

  it("keeps the timeline by identity when nothing overhangs", () => {
    const t = timelineOf([laneWith([[0, 60]])]);
    expect(fitMediaTimeline(t, 90)).toBe(t);
  });

  it("leaves everything alone before a duration is known", () => {
    const t = timelineOf([laneWith([[0, 120]])]);
    expect(fitMediaTimeline(t, 0)).toBe(t);
  });
});
