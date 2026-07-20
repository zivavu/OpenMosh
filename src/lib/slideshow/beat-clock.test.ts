import { describe, expect, test } from "bun:test";
import { beatAtTime, createBeatClock } from "./beat-clock";
import type { TimelineSegment } from "./types";

describe("createBeatClock", () => {
  test("120 BPM quarter-beats tick every 0.5s", () => {
    const clock = createBeatClock(120, 1, 0);
    expect(clock.intervalSeconds).toBeCloseTo(0.5);
    expect(clock.beatAt(0).index).toBe(0);
    expect(clock.beatAt(0.49).index).toBe(0);
    expect(clock.beatAt(0.5).index).toBe(1);
    expect(clock.beatAt(1.25).index).toBe(2);
    expect(clock.beatAt(1.25).fraction).toBeCloseTo(0.5);
  });

  test("offset shifts the first beat later", () => {
    const clock = createBeatClock(120, 1, 0.25);
    expect(clock.beatAt(0.24).index).toBe(0);
    expect(clock.beatAt(0.25).index).toBe(0);
    expect(clock.beatAt(0.75).index).toBe(1);
  });

  test("subdivision 0 (stop) holds a sentinel beat forever", () => {
    const clock = createBeatClock(120, 0, 0);
    expect(clock.intervalSeconds).toBe(Infinity);
    expect(clock.beatAt(9999).index).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("beatAtTime", () => {
  const seg = (
    startTime: number,
    endTime: number | null,
    subdivision: TimelineSegment["subdivision"],
  ): TimelineSegment => ({
    id: `${startTime}`,
    startTime,
    endTime,
    subdivision,
  });

  test("falls back to the default subdivision when no segment covers t", () => {
    const { index } = beatAtTime(1.0, 120, 0, [], 1);
    expect(index).toBe(2); // 1.0s / 0.5s
  });

  test("uses the covering segment's subdivision", () => {
    // Segment [0,2) at half-beats (subdivision 0.5) → interval 0.25s at 120 BPM
    const segments = [seg(0, 2, 0.5)];
    expect(beatAtTime(1.0, 120, 0, segments, 1).index).toBe(4);
  });

  test("a stop segment (subdivision 0) yields the sentinel index", () => {
    const segments = [seg(0, null, 0)];
    expect(beatAtTime(5, 120, 0, segments, 1).index).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  test("later overlapping segment wins", () => {
    const segments = [seg(0, 4, 1), seg(1, 3, 0.5)];
    // At t=2 the second segment (0.5 → 0.25s interval) is active → 2/0.25 = 8
    expect(beatAtTime(2, 120, 0, segments, 1).index).toBe(8);
  });
});
