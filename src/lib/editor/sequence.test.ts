import { describe, expect, test } from "bun:test";
import type { MoshOptions } from "./mosh";
import {
  createSequenceEffectSource,
  createSequenceSegment,
  findSegmentAt,
  rollEffects,
  segmentTick,
  withSeededRandom,
  type SequenceSegment,
} from "./sequence";

const OPTIONS: MoshOptions = {
  moshMin: 3,
  moshMax: 6,
  randomizeOrder: true,
  moshAudioLink: false,
  moshAudioLinkStrength: 0,
  hasAudio: false,
  audioSampleRate: 0,
  frequencyData: null,
};

/** Compare two effect lists by the fields that drive render output. */
function renderShape(effects: { defId: string; enabled: boolean; values: Record<string, unknown> }[]) {
  return effects.map((e) => ({
    defId: e.defId,
    enabled: e.enabled,
    values: e.values,
  }));
}

describe("withSeededRandom", () => {
  test("same seed reproduces the same random stream", () => {
    const a = withSeededRandom(42, () => [Math.random(), Math.random(), Math.random()]);
    const b = withSeededRandom(42, () => [Math.random(), Math.random(), Math.random()]);
    expect(a).toEqual(b);
  });

  test("restores the global Math.random afterward", () => {
    const original = Math.random;
    withSeededRandom(1, () => Math.random());
    expect(Math.random).toBe(original);
  });

  test("different seeds diverge", () => {
    const a = withSeededRandom(1, () => Math.random());
    const b = withSeededRandom(2, () => Math.random());
    expect(a).not.toBe(b);
  });
});

describe("rollEffects determinism (preview/export contract)", () => {
  test("same seed + options → identical effects", () => {
    const a = rollEffects(12345, OPTIONS);
    const b = rollEffects(12345, OPTIONS);
    expect(renderShape(a)).toEqual(renderShape(b));
  });

  test("at least one enabled effect for a normal mosh", () => {
    const rolled = rollEffects(777, OPTIONS);
    expect(rolled.some((e) => e.enabled)).toBe(true);
  });

  test("different seeds generally produce different results", () => {
    const a = rollEffects(1, OPTIONS);
    const b = rollEffects(2, OPTIONS);
    expect(renderShape(a)).not.toEqual(renderShape(b));
  });
});

describe("findSegmentAt", () => {
  const segs: SequenceSegment[] = [
    createSequenceSegment(0, 2),
    createSequenceSegment(2, 5),
  ];

  test("returns the segment covering the time", () => {
    expect(findSegmentAt(segs, 1, 5)?.startTime).toBe(0);
    expect(findSegmentAt(segs, 3, 5)?.startTime).toBe(2);
  });

  test("end is exclusive, start inclusive", () => {
    expect(findSegmentAt(segs, 2, 5)?.startTime).toBe(2);
  });

  test("returns null outside all segments", () => {
    expect(findSegmentAt(segs, 6, 5)).toBeNull();
  });

  test("later start wins on overlap", () => {
    const overlap: SequenceSegment[] = [
      createSequenceSegment(0, 5),
      createSequenceSegment(1, 3),
    ];
    expect(findSegmentAt(overlap, 2, 5)?.startTime).toBe(1);
  });
});

describe("segmentTick", () => {
  test("0-based tick index by interval from segment start", () => {
    const seg = createSequenceSegment(1, 5);
    seg.mode = "interval";
    seg.intervalSec = 0.25;
    expect(segmentTick(seg, 1)).toBe(0);
    expect(segmentTick(seg, 1.24)).toBe(0);
    expect(segmentTick(seg, 1.25)).toBe(1);
    expect(segmentTick(seg, 2)).toBe(4);
  });
});

describe("createSequenceEffectSource", () => {
  test("interval rolls are identical across independently built sources (preview == export)", () => {
    const seg = createSequenceSegment(0, 4);
    seg.mode = "interval";
    seg.intervalSec = 0.5;
    seg.seed = 99;
    const segs = [seg];

    const preview = createSequenceEffectSource(() => segs, () => 4, () => OPTIONS);
    const exportSrc = createSequenceEffectSource(
      () => segs,
      () => 4,
      () => OPTIONS,
      { cloneStatic: true },
    );

    for (const t of [0, 0.5, 1.0, 2.25, 3.9]) {
      expect(renderShape(preview(t)!)).toEqual(renderShape(exportSrc(t)!));
    }
  });

  test("static segments return the segment's own effects (no clone) by default", () => {
    const seg = createSequenceSegment(0, 4);
    const src = createSequenceEffectSource(() => [seg], () => 4, () => OPTIONS);
    expect(src(1)).toBe(seg.effects);
  });

  test("cloneStatic returns a stable clone, not the original array", () => {
    const seg = createSequenceSegment(0, 4);
    const src = createSequenceEffectSource(
      () => [seg],
      () => 4,
      () => OPTIONS,
      { cloneStatic: true },
    );
    const first = src(1);
    expect(first).not.toBe(seg.effects);
    expect(src(2)).toBe(first); // cached per segment
  });

  test("returns null on a gap", () => {
    const seg = createSequenceSegment(0, 2);
    const src = createSequenceEffectSource(() => [seg], () => 5, () => OPTIONS);
    expect(src(3)).toBeNull();
  });
});
