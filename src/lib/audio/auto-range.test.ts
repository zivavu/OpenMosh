import { beforeEach, describe, expect, it } from "bun:test";
import {
  autoRangeLevel,
  dropAutoRangeScope,
  resetAutoRange,
  smoothBandLevel,
} from "./auto-range";

/** Run a level signal through the smoother at a given frame rate. */
function runAtFps(
  key: string,
  levelAt: (t: number) => number,
  seconds: number,
  fps: number,
): number {
  const dt = 1 / fps;
  let out = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    out = smoothBandLevel(key, levelAt(i * dt), dt);
  }
  return out;
}

describe("smoothBandLevel", () => {
  beforeEach(resetAutoRange);

  it("lands in the same place at 30 and 60 fps", () => {
    // The whole point: an export at 30 fps has to agree with a preview at 60.
    const signal = (t: number) => 0.2 + 0.6 * Math.abs(Math.sin(t * 4));
    const at30 = runAtFps("a", signal, 4, 30);
    resetAutoRange();
    const at60 = runAtFps("a", signal, 4, 60);
    expect(Math.abs(at30 - at60)).toBeLessThan(0.02);
  });

  it("agrees at 144 fps too, so the preview doesn't ride the refresh rate", () => {
    const signal = (t: number) => 0.2 + 0.6 * Math.abs(Math.sin(t * 4));
    const at60 = runAtFps("a", signal, 4, 60);
    resetAutoRange();
    const at144 = runAtFps("a", signal, 4, 144);
    expect(Math.abs(at60 - at144)).toBeLessThan(0.02);
  });

  it("damps a one-frame spike instead of passing it through", () => {
    // A raw FFT transient is what used to pin the auto-range ceiling.
    smoothBandLevel("a", 0.1, 1 / 60);
    const spiked = smoothBandLevel("a", 1, 1 / 60);
    expect(spiked).toBeLessThan(0.35);
  });

  it("still reaches a sustained level", () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = smoothBandLevel("a", 1, 1 / 60);
    expect(v).toBeGreaterThan(0.95);
  });

  it("takes the first sample as-is, so nothing ramps up from zero", () => {
    expect(smoothBandLevel("a", 0.4, 1 / 60)).toBe(0.4);
  });

  it("keeps bands independent", () => {
    smoothBandLevel("low", 1, 1 / 60);
    expect(smoothBandLevel("high", 0.2, 1 / 60)).toBe(0.2);
  });

  it("survives a stalled clock without snapping to the input", () => {
    smoothBandLevel("a", 0, 1 / 60);
    expect(smoothBandLevel("a", 1, 30)).toBeLessThan(1);
  });

  it("is cleared by resetAutoRange", () => {
    smoothBandLevel("a", 1, 1 / 60);
    resetAutoRange();
    expect(smoothBandLevel("a", 0.3, 1 / 60)).toBe(0.3);
  });

  it("falls back slower than it rises", () => {
    // The point of the asymmetry: catch the kick, glide off it.
    smoothBandLevel("a", 0, 1 / 60);
    const up = smoothBandLevel("a", 1, 1 / 60);
    resetAutoRange();
    smoothBandLevel("a", 1, 1 / 60);
    const down = 1 - smoothBandLevel("a", 0, 1 / 60);
    expect(down).toBeLessThan(up / 2);
  });

  it("glides off a hit for longer at higher smoothing", () => {
    const decay = (smoothing: number) => {
      resetAutoRange();
      smoothBandLevel("a", 1, 1 / 60, smoothing);
      let v = 1;
      for (let i = 0; i < 30; i++) v = smoothBandLevel("a", 0, 1 / 60, smoothing);
      return v;
    };
    expect(decay(1)).toBeGreaterThan(decay(0.45));
    expect(decay(0.45)).toBeGreaterThan(decay(0));
  });
});

describe("autoRangeLevel", () => {
  beforeEach(resetAutoRange);

  it("falls back to the raw level once a band goes steady", () => {
    // A band with no dynamics used to bail out at 0, snapping every param
    // linked to it to the bottom of its range.
    let v = 0;
    for (let i = 0; i < 600; i++) v = autoRangeLevel("k", 0.4, 1 / 60);
    expect(v).toBeCloseTo(0.4, 1);
  });

  it("still reads silence as silence", () => {
    let v = 1;
    for (let i = 0; i < 600; i++) v = autoRangeLevel("k", 0, 1 / 60);
    expect(v).toBeLessThan(0.05);
  });

  it("does not let a single-frame spike own the whole range", () => {
    for (let i = 0; i < 120; i++) autoRangeLevel("k", 0.3, 1 / 60);
    autoRangeLevel("k", 1, 1 / 60);
    // The spike itself reads as a peak, but the frames after it must not all
    // collapse onto the floor of a range stretched to fit one frame.
    expect(autoRangeLevel("k", 0.3, 1 / 60)).toBeLessThan(0.35);
    let v = 0;
    for (let i = 0; i < 30; i++) v = autoRangeLevel("k", 0.45, 1 / 60);
    expect(v).toBeGreaterThan(0.5);
  });
});

describe("smoothed levels through auto-ranging", () => {
  beforeEach(resetAutoRange);

  /** The ranged output over a steady beat: a kick every half second. */
  function beatResponse(smooth: boolean, fps: number): number[] {
    const dt = 1 / fps;
    const beatEvery = Math.round(fps / 2);
    const out: number[] = [];
    for (let i = 0; i < fps * 8; i++) {
      const measured = i % beatEvery === 0 ? 0.9 : 0.15;
      const level = smooth ? smoothBandLevel("k", measured, dt) : measured;
      out.push(autoRangeLevel("k", level, dt));
    }
    // Second half only, once the envelope has learned the range.
    return out.slice(out.length / 2);
  }

  /** Share of frames somewhere between the extremes — the part of the signal
   * that reads as movement rather than a flicker. */
  function midRangeShare(out: number[]): number {
    return out.filter((v) => v > 0.2 && v < 0.8).length / out.length;
  }

  it("gives a 30 fps export the same beat response as a 60 fps preview", () => {
    const at60 = midRangeShare(beatResponse(true, 60));
    resetAutoRange();
    const at30 = midRangeShare(beatResponse(true, 30));
    expect(Math.abs(at60 - at30)).toBeLessThan(0.15);
  });

  it("turns the beat into movement instead of an on/off flicker", () => {
    // Both span the full range, but raw single-frame spikes pin the ceiling and
    // drop everything else on the floor — the render stops reading as connected
    // to the kick because nothing sits between the two extremes.
    const smoothed = beatResponse(true, 30);
    resetAutoRange();
    const raw = beatResponse(false, 30);
    expect(Math.max(...raw) - Math.min(...raw)).toBeCloseTo(1, 1);
    // Raw is all-or-nothing; smoothed spends several frames per kick in between.
    expect(midRangeShare(raw)).toBeLessThan(0.05);
    expect(midRangeShare(smoothed)).toBeGreaterThan(0.15);
  });
});

describe("dropAutoRangeScope", () => {
  it("forgets only the named scope's bands", () => {
    resetAutoRange();
    // Drive two scopes to clearly different envelopes.
    for (let i = 0; i < 40; i++) {
      smoothBandLevel("laneA|20:250", 0.9, 1 / 60, 0.5);
      autoRangeLevel("laneA|20:250", 0.9, 1 / 60);
      smoothBandLevel("laneB|20:250", 0.1, 1 / 60, 0.5);
      autoRangeLevel("laneB|20:250", 0.1, 1 / 60);
    }
    const bBefore = smoothBandLevel("laneB|20:250", 0.1, 1 / 60, 0.5);

    dropAutoRangeScope("laneA");

    // A dropped scope starts over: the first sample is returned as-is.
    expect(smoothBandLevel("laneA|20:250", 0.2, 1 / 60, 0.5)).toBe(0.2);
    // The other scope kept following where it was.
    expect(smoothBandLevel("laneB|20:250", 0.1, 1 / 60, 0.5)).toBeCloseTo(
      bBefore,
      5,
    );
  });

  it("leaves a scope whose id is a prefix of another alone", () => {
    resetAutoRange();
    smoothBandLevel("lane1|20:250", 0.5, 1 / 60, 0.5);
    smoothBandLevel("lane10|20:250", 0.5, 1 / 60, 0.5);
    dropAutoRangeScope("lane1");
    // lane10 is not lane1 — the "|" in the prefix is what keeps them apart.
    expect(smoothBandLevel("lane10|20:250", 0.9, 1 / 60, 0.5)).not.toBe(0.9);
  });
});
