import { describe, expect, test } from "bun:test";
import { createEffectInstance, EFFECT_DEFINITIONS } from "../effects";
import {
  copySegments,
  pasteClipsAt,
  pasteContentOnto,
} from "./sequence-clipboard";
import type { SequenceSegment } from "./sequence";

const DURATION = 10;

function seg(
  id: string,
  startTime: number,
  endTime: number | null,
  over: Partial<SequenceSegment> = {},
): SequenceSegment {
  return {
    id,
    startTime,
    endTime,
    mode: "static",
    label: id,
    effects: [],
    ...over,
  };
}

/** Segments as [start, end, label] triples, in time order. */
function shape(segments: SequenceSegment[]) {
  return [...segments]
    .sort((a, b) => a.startTime - b.startTime)
    .map((s) => [s.startTime, s.endTime ?? DURATION, s.label]);
}

describe("copySegments", () => {
  test("offsets are relative to the earliest copied segment", () => {
    const clips = copySegments([seg("b", 4, 6), seg("a", 2, 4)], DURATION);
    expect(clips.map((c) => [c.offsetStart, c.offsetEnd])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(clips[0].content.label).toBe("a");
  });

  test("an open-ended segment measures to the track duration", () => {
    const clips = copySegments([seg("a", 8, null)], DURATION);
    expect(clips[0].offsetEnd).toBe(2);
  });

  test("effects are deep-copied, so later edits don't leak into the clipboard", () => {
    const source = seg("a", 0, 2, { effects: [createEffectInstance(EFFECT_DEFINITIONS[0])] });
    const clips = copySegments([source], DURATION);
    source.effects[0].enabled = !source.effects[0].enabled;
    expect(clips[0].content.effects[0].enabled).not.toBe(
      source.effects[0].enabled,
    );
  });
});

describe("pasteClipsAt", () => {
  test("stamps content into the middle of a segment, splitting it in two", () => {
    const clips = copySegments([seg("src", 0, 2, { label: "src" })], DURATION);
    const out = pasteClipsAt([seg("a", 0, null)], clips, 4, DURATION);
    expect(shape(out)).toEqual([
      [0, 4, "a"],
      [4, 6, "src"],
      [6, 10, "a"],
    ]);
  });

  test("preserves the copied layout across a multi-segment span", () => {
    const clips = copySegments(
      [seg("x", 0, 1, { label: "x" }), seg("y", 1, 3, { label: "y" })],
      DURATION,
    );
    const out = pasteClipsAt([seg("a", 0, null)], clips, 5, DURATION);
    expect(shape(out)).toEqual([
      [0, 5, "a"],
      [5, 6, "x"],
      [6, 8, "y"],
      [8, 10, "a"],
    ]);
  });

  test("fully covered segments are replaced, not left behind", () => {
    const existing = [seg("a", 0, 3), seg("b", 3, 5), seg("c", 5, null)];
    const clips = copySegments([seg("src", 0, 4, { label: "src" })], DURATION);
    const out = pasteClipsAt(existing, clips, 2, DURATION);
    expect(shape(out)).toEqual([
      [0, 2, "a"],
      [2, 6, "src"],
      [6, 10, "c"],
    ]);
  });

  test("clips are trimmed at the track end", () => {
    const clips = copySegments([seg("src", 0, 4, { label: "src" })], DURATION);
    const out = pasteClipsAt([seg("a", 0, null)], clips, 8, DURATION);
    expect(shape(out)).toEqual([
      [0, 8, "a"],
      [8, 10, "src"],
    ]);
  });

  test("a clip pushed entirely past the end is skipped", () => {
    const clips = copySegments([seg("src", 0, 2)], DURATION);
    const out = pasteClipsAt([seg("a", 0, null)], clips, 10, DURATION);
    expect(shape(out)).toEqual([[0, 10, "a"]]);
  });

  test("coverage stays gapless and non-overlapping", () => {
    const clips = copySegments(
      [seg("x", 0, 1), seg("y", 1, 2.5)],
      DURATION,
    );
    const out = pasteClipsAt(
      [seg("a", 0, 3), seg("b", 3, 7), seg("c", 7, null)],
      clips,
      2,
      DURATION,
    );
    const sorted = [...out].sort((a, b) => a.startTime - b.startTime);
    expect(sorted[0].startTime).toBe(0);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startTime).toBeCloseTo(
        sorted[i - 1].endTime ?? DURATION,
        6,
      );
    }
    expect(sorted[sorted.length - 1].endTime ?? DURATION).toBe(DURATION);
  });

  test("pasting onto an empty timeline is a no-op", () => {
    const clips = copySegments([seg("src", 0, 2)], DURATION);
    expect(pasteClipsAt([], clips, 1, DURATION)).toEqual([]);
  });
});

describe("pasteContentOnto", () => {
  test("overwrites content but keeps the target's id and span", () => {
    const clips = copySegments(
      [seg("src", 0, 2, { label: "src", mode: "interval", intervalSec: 0.5 })],
      DURATION,
    );
    const out = pasteContentOnto([seg("a", 3, 7)], ["a"], clips);
    expect(out[0]).toMatchObject({
      id: "a",
      startTime: 3,
      endTime: 7,
      label: "src",
      mode: "interval",
      intervalSec: 0.5,
    });
  });

  test("a single clip fills every selected target", () => {
    const clips = copySegments([seg("src", 0, 2, { label: "src" })], DURATION);
    const out = pasteContentOnto(
      [seg("a", 0, 2), seg("b", 2, 4), seg("c", 4, null)],
      ["a", "c"],
      clips,
    );
    expect(shape(out)).toEqual([
      [0, 2, "src"],
      [2, 4, "b"],
      [4, 10, "src"],
    ]);
  });

  test("multiple clips map onto targets in time order", () => {
    const clips = copySegments(
      [seg("x", 0, 1, { label: "x" }), seg("y", 1, 2, { label: "y" })],
      DURATION,
    );
    const out = pasteContentOnto(
      [seg("a", 0, 2), seg("b", 2, 4), seg("c", 4, null)],
      ["c", "a", "b"],
      clips,
    );
    expect(shape(out)).toEqual([
      [0, 2, "x"],
      [2, 4, "y"],
      [4, 10, "x"],
    ]);
  });

  test("targets don't share effect instances with each other", () => {
    const clips = copySegments(
      [seg("src", 0, 2, { effects: [createEffectInstance(EFFECT_DEFINITIONS[0])] })],
      DURATION,
    );
    const out = pasteContentOnto([seg("a", 0, 2), seg("b", 2, 4)], ["a", "b"], clips);
    expect(out[0].effects[0]).not.toBe(out[1].effects[0]);
  });
});
