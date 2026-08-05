import { describe, expect, test } from "bun:test";
import {
  clampGroupDelta,
  collectGroupBoundaries,
  groupBoundaryTimesAfter,
  groupDeltaUpdates,
  nonSelectedBoundaryTimes,
} from "./boundary-group-drag";

const DURATION = 10;
const MIN_SEG = 0.125;

interface Seg {
  id: string;
  startTime: number;
  endTime?: number | null;
}

/** Boundaries at 2, 4, 6, 8. */
const SEGS: Seg[] = [
  { id: "a", startTime: 0, endTime: 2 },
  { id: "b", startTime: 2, endTime: 4 },
  { id: "c", startTime: 4, endTime: 6 },
  { id: "d", startTime: 6, endTime: 8 },
  { id: "e", startTime: 8, endTime: 10 },
];

describe("collectGroupBoundaries", () => {
  test("resolves each boundary to the segments on either side", () => {
    expect(collectGroupBoundaries(SEGS, [4, 6], DURATION)).toEqual([
      { time: 4, leftSegId: "b", rightSegId: "c" },
      { time: 6, leftSegId: "c", rightSegId: "d" },
    ]);
  });

  test("track ends have no segment on the outer side", () => {
    const out = collectGroupBoundaries(
      [{ id: "a", startTime: 0, endTime: null }],
      [0, DURATION],
      DURATION,
    );
    expect(out).toEqual([
      { time: 0, leftSegId: null, rightSegId: null },
      { time: 10, leftSegId: null, rightSegId: null },
    ]);
  });
});

describe("nonSelectedBoundaryTimes", () => {
  test("returns the fixed boundaries plus both track ends", () => {
    expect(nonSelectedBoundaryTimes(SEGS, [4], DURATION)).toEqual([
      0, 2, 6, 8, 10,
    ]);
  });
});

describe("clampGroupDelta", () => {
  const group = collectGroupBoundaries(SEGS, [4, 6], DURATION);
  const fixed = nonSelectedBoundaryTimes(SEGS, [4, 6], DURATION);

  test("passes a delta that keeps clear of the fixed neighbours", () => {
    expect(clampGroupDelta(1, group, fixed, DURATION, MIN_SEG)).toBe(1);
  });

  test("stops the trailing boundary short of the next fixed one", () => {
    // 6 must stay MIN_SEG below 8
    expect(clampGroupDelta(5, group, fixed, DURATION, MIN_SEG)).toBeCloseTo(
      2 - MIN_SEG,
      6,
    );
  });

  test("stops the leading boundary short of the previous fixed one", () => {
    expect(clampGroupDelta(-5, group, fixed, DURATION, MIN_SEG)).toBeCloseTo(
      -(2 - MIN_SEG),
      6,
    );
  });

  test("keeps the group inside the track when nothing else blocks it", () => {
    const solo = collectGroupBoundaries(SEGS, [8], DURATION);
    const none: number[] = [];
    expect(clampGroupDelta(99, solo, none, DURATION, MIN_SEG)).toBeCloseTo(
      2 - MIN_SEG,
      6,
    );
    expect(clampGroupDelta(-99, solo, none, DURATION, MIN_SEG)).toBeCloseTo(
      MIN_SEG - 8,
      6,
    );
  });

  test("a boundary with no room at all yields no movement", () => {
    expect(clampGroupDelta(1, group, fixed, 0.1, MIN_SEG)).toBe(0);
  });
});

describe("groupDeltaUpdates", () => {
  test("moves both sides of each boundary together", () => {
    const group = collectGroupBoundaries(SEGS, [4, 6], DURATION);
    expect(groupDeltaUpdates(group, 1)).toEqual({
      b: { endTime: 5 },
      c: { startTime: 5, endTime: 7 },
      d: { startTime: 7 },
    });
  });

  test("a segment between two dragged boundaries keeps its length", () => {
    const group = collectGroupBoundaries(SEGS, [4, 6], DURATION);
    const u = groupDeltaUpdates(group, 1.5);
    expect(u.c.endTime! - u.c.startTime!).toBeCloseTo(2, 6);
  });
});

describe("groupBoundaryTimesAfter", () => {
  test("reads the moved positions back off the segments", () => {
    const group = collectGroupBoundaries(SEGS, [4, 6], DURATION);
    const moved: Seg[] = [
      { id: "a", startTime: 0, endTime: 2 },
      { id: "b", startTime: 2, endTime: 5 },
      { id: "c", startTime: 5, endTime: 7 },
      { id: "d", startTime: 7, endTime: 8 },
      { id: "e", startTime: 8, endTime: 10 },
    ];
    expect(groupBoundaryTimesAfter(group, moved, DURATION)).toEqual([5, 7]);
  });

  test("skips boundaries whose segments are gone", () => {
    const group = collectGroupBoundaries(SEGS, [4], DURATION);
    expect(groupBoundaryTimesAfter(group, [], DURATION)).toEqual([]);
  });
});
