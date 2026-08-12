import { describe, expect, test } from "bun:test";
import { randomizeSegmentSources } from "./segment-edits";
import type { SequenceSegment } from "./sequence";

function seg(id: string, over: Partial<SequenceSegment> = {}): SequenceSegment {
  return {
    id,
    startTime: 0,
    endTime: null,
    mode: "static",
    label: id,
    effects: [],
    ...over,
  };
}

const segs = (n: number) =>
  Array.from({ length: n }, (_, i) => seg(`s${i}`));

const idsOf = (segments: SequenceSegment[]) =>
  new Set(segments.map((s) => s.id));

describe("randomizeSegmentSources", () => {
  test("deals a source to every named segment and leaves the rest alone", () => {
    const segments = [...segs(3), seg("keep", { sourceId: "a" })];
    const out = randomizeSegmentSources(
      segments,
      new Set(["s0", "s1", "s2"]),
      ["a", "b", "c"],
    );
    for (const s of out.slice(0, 3)) expect(s.sourceId).toBeDefined();
    expect(out[3]).toBe(segments[3]);
  });

  test("uses the whole pool before repeating any of it", () => {
    const segments = segs(3);
    const out = randomizeSegmentSources(segments, idsOf(segments), [
      "a",
      "b",
      "c",
    ]);
    expect(new Set(out.map((s) => s.sourceId))).toEqual(
      new Set(["a", "b", "c"]),
    );
  });

  test("never lands the same source on two segments in a row", () => {
    // Enough deals to cross several reshuffles, where a naive deck repeats.
    const segments = segs(60);
    for (let run = 0; run < 20; run++) {
      const out = randomizeSegmentSources(segments, idsOf(segments), [
        "a",
        "b",
        "c",
      ]);
      for (let i = 1; i < out.length; i++) {
        expect(out[i].sourceId).not.toBe(out[i - 1].sourceId);
      }
    }
  });

  test("stores the primary as undefined, like assigning it by hand", () => {
    const segments = segs(4);
    const out = randomizeSegmentSources(
      segments,
      idsOf(segments),
      ["primary"],
      "primary",
    );
    for (const s of out) expect(s.sourceId).toBeUndefined();
  });

  test("an empty pool changes nothing", () => {
    const segments = segs(2);
    expect(randomizeSegmentSources(segments, idsOf(segments), [])).toBe(
      segments,
    );
  });
});
