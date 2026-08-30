import { describe, expect, it } from "bun:test";
import { maskShift, maskToSdf, MASK_SDF_RANGE, sdfCoverage } from "./mask-sdf";

/** A 1-pixel-tall mask, white (kept) except for an erased run. */
function strip(w: number, from: number, to: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * 4);
  for (let x = 0; x < w; x++) {
    const kept = x < from || x >= to;
    px[x * 4] = kept ? 255 : 0;
    px[x * 4 + 1] = px[x * 4];
    px[x * 4 + 2] = px[x * 4];
    px[x * 4 + 3] = 255;
  }
  return px;
}

/** Where the erased run sits after reconstructing coverage from a field. */
function erasedRun(enc: number[]): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (let x = 0; x < enc.length; x++) {
    if (sdfCoverage(enc[x]) < 0.5) {
      if (from < 0) from = x;
      to = x + 1;
    }
  }
  return from < 0 ? null : { from, to };
}

describe("maskToSdf", () => {
  it("keeps the painting in red and the distance in alpha", () => {
    const { data: out, centre } = maskToSdf(strip(32, 8, 16), 32, 1);
    // Red is untouched coverage, so a still mask renders exactly as painted.
    expect(out[0]).toBe(255);
    expect(out[10 * 4]).toBe(0);
    // Alpha crosses 0.5 at the edge: erased below, kept above.
    expect(out[10 * 4 + 3]).toBeLessThan(128);
    expect(out[0 + 3]).toBeGreaterThan(128);
    // Middle of the erased run, normalized: (8..16) centres on 11.5 of 32.
    expect(centre?.x).toBeCloseTo(11.5 / 32, 6);
  });

  it("puts the contour half a pixel outside the erased run", () => {
    const { data: out } = maskToSdf(strip(32, 8, 16), 32, 1);
    // One pixel each side of the boundary, equal and opposite.
    const inside = (out[8 * 4 + 3] / 255 - 0.5) * 2 * MASK_SDF_RANGE;
    const outside = (out[7 * 4 + 3] / 255 - 0.5) * 2 * MASK_SDF_RANGE;
    expect(inside).toBeLessThan(0);
    expect(outside).toBeGreaterThan(0);
    expect(Math.abs(inside + outside)).toBeLessThan(2);
  });
});

describe("morphing two shapes", () => {
  const W = 64;
  const a = maskToSdf(strip(W, 8, 16), W, 1);
  const b = maskToSdf(strip(W, 48, 56), W, 1);

  const shift = maskShift(a.centre, b.centre);
  const enc = (f: typeof a, x: number) => {
    const c = Math.min(Math.max(x, 0), W - 1);
    return f.data[c * 4 + 3] / 255;
  };

  // The shader's alignment: both shapes slid onto the middle they travel
  // through, so their boundaries overlap and have something to interpolate.
  const at = (mix: number) =>
    erasedRun(
      Array.from({ length: W }, (_, x) => {
        const ea = enc(a, x - Math.round(shift.x * mix * W));
        const eb = enc(b, x + Math.round(shift.x * (1 - mix) * W));
        return ea + (eb - ea) * mix;
      }),
    );

  it("measures the gap between the two middles", () => {
    expect(shift.x).toBeCloseTo((51.5 - 11.5) / W, 6);
  });

  it("lands on each painting at the ends", () => {
    expect(at(0)).toEqual({ from: 8, to: 16 });
    expect(at(1)).toEqual({ from: 48, to: 56 });
  });

  it("travels rather than cross-fading", () => {
    // The whole point: one run, between the two, roughly the size of both —
    // not two runs at half strength, which is what blending the masks gave.
    const mid = at(0.5)!;
    expect(mid).not.toBeNull();
    const centre = (mid.from + mid.to) / 2;
    expect(centre).toBeGreaterThan(24);
    expect(centre).toBeLessThan(40);
    expect(mid.to - mid.from).toBeGreaterThan(4);
    expect(mid.to - mid.from).toBeLessThan(16);
  });

  it("moves monotonically across the morph", () => {
    const centres = [0, 0.25, 0.5, 0.75, 1].map((m) => {
      const r = at(m)!;
      return (r.from + r.to) / 2;
    });
    for (let i = 1; i < centres.length; i++) {
      expect(centres[i]).toBeGreaterThan(centres[i - 1]);
    }
  });
});
