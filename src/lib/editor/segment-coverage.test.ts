import { describe, expect, test } from "bun:test";
import { normalizeCoverage } from "./segment-coverage";

const DURATION = 10;

interface Seg {
  id: string;
  startTime: number;
  endTime?: number | null;
}

function seg(id: string, startTime: number, endTime: number | null): Seg {
  return { id, startTime, endTime };
}

function shape(segments: Seg[]) {
  return segments.map((s) => [s.id, s.startTime, s.endTime]);
}

/** The invariant every timeline relies on. */
function expectCovers(segments: Seg[], duration = DURATION) {
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0].startTime).toBe(0);
  for (let i = 1; i < segments.length; i++) {
    expect(segments[i].startTime).toBeCloseTo(segments[i - 1].endTime ?? -1, 6);
  }
  expect(segments[segments.length - 1].endTime).toBe(duration);
}

describe("normalizeCoverage", () => {
  test("leaves an already-valid list untouched, by identity", () => {
    const input = [seg("a", 0, 4), seg("b", 4, 10)];
    expect(normalizeCoverage(input, DURATION)).toBe(input);
  });

  test("treats a null endTime on the last segment as the duration", () => {
    const input = [seg("a", 0, 4), seg("b", 4, null)];
    expect(normalizeCoverage(input, DURATION)).toBe(input);
  });

  test("extends the last segment when the track got longer", () => {
    const out = normalizeCoverage([seg("a", 0, 3), seg("b", 3, 6)], DURATION);
    expect(shape(out)).toEqual([
      ["a", 0, 3],
      ["b", 3, 10],
    ]);
    expectCovers(out);
  });

  test("drops segments left beyond the end when the track got shorter", () => {
    const out = normalizeCoverage(
      [seg("a", 0, 3), seg("b", 3, 12), seg("c", 12, 20)],
      DURATION,
    );
    expect(shape(out)).toEqual([
      ["a", 0, 3],
      ["b", 3, 10],
    ]);
    expectCovers(out);
  });

  test("recovers boundaries dragged past the end of the track", () => {
    const out = normalizeCoverage(
      [seg("a", 0, 4), seg("b", 14, 18), seg("c", 18, 22)],
      DURATION,
    );
    expect(shape(out)).toEqual([["a", 0, 10]]);
    expectCovers(out);
  });

  test("closes a gap in the middle", () => {
    const out = normalizeCoverage([seg("a", 0, 3), seg("b", 6, 10)], DURATION);
    expect(shape(out)).toEqual([
      ["a", 0, 3],
      ["b", 3, 10],
    ]);
    expectCovers(out);
  });

  test("closes a leading gap", () => {
    const out = normalizeCoverage([seg("a", 2, 10)], DURATION);
    expect(shape(out)).toEqual([["a", 0, 10]]);
  });

  test("resolves overlaps in favour of the earlier segment", () => {
    const out = normalizeCoverage(
      [seg("a", 0, 6), seg("b", 3, 8), seg("c", 8, 10)],
      DURATION,
    );
    expect(shape(out)).toEqual([
      ["a", 0, 6],
      ["b", 6, 8],
      ["c", 8, 10],
    ]);
    expectCovers(out);
  });

  test("drops a segment fully swallowed by an overlap", () => {
    const out = normalizeCoverage(
      [seg("a", 0, 8), seg("b", 3, 5), seg("c", 8, 10)],
      DURATION,
    );
    expect(shape(out)).toEqual([
      ["a", 0, 8],
      ["c", 8, 10],
    ]);
    expectCovers(out);
  });

  test("keeps content when every segment is out of range", () => {
    const out = normalizeCoverage([seg("a", 20, 24), seg("b", 24, 30)], DURATION);
    expect(out.length).toBe(1);
    expectCovers(out);
  });

  test("negative times are pulled back to zero", () => {
    const out = normalizeCoverage([seg("a", -5, 4), seg("b", 4, 10)], DURATION);
    expect(shape(out)).toEqual([
      ["a", 0, 4],
      ["b", 4, 10],
    ]);
  });

  test("array order isn't part of the invariant - both timelines sort for display", () => {
    const input = [seg("b", 4, 10), seg("a", 0, 4)];
    expect(normalizeCoverage(input, DURATION)).toBe(input);
  });

  test("emits in time order when it does have to rebuild", () => {
    const out = normalizeCoverage([seg("b", 4, 12), seg("a", 0, 4)], DURATION);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expectCovers(out);
  });

  test("is idempotent", () => {
    const once = normalizeCoverage(
      [seg("a", 0, 3), seg("b", 6, 14), seg("c", 14, 20)],
      DURATION,
    );
    expect(normalizeCoverage(once, DURATION)).toBe(once);
  });

  test("an empty list and a zero duration are left alone", () => {
    expect(normalizeCoverage([], DURATION)).toEqual([]);
    const input = [seg("a", 0, 4)];
    expect(normalizeCoverage(input, 0)).toBe(input);
  });
});
