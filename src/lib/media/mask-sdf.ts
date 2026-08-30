/**
 * Erase masks as signed distance fields, so two painted shapes have an honest
 * in-between.
 *
 * Cross-fading the masks themselves shows both blobs at half strength, which
 * reads as ghosting rather than as motion — it was tried and rejected. A
 * distance field moves the *boundary* instead: halfway between two keys the
 * shape is one blob, halfway along, the right size. Same trick a font atlas
 * uses to stay sharp, applied to interpolation rather than to magnification.
 */

/**
 * How far from the edge the field still carries a gradient, in mask pixels.
 * Beyond this it saturates and two shapes further apart than this shrink out
 * and grow in rather than travelling. Sized against `MASK_MAX` (512): a quarter
 * of the mask is a long way for a hand-painted blob to move between two keys,
 * and every doubling costs a pixel of precision in the 8 bits it is stored in.
 */
export const MASK_SDF_RANGE = 128;

/**
 * Squared 1-D distance transform (Felzenszwalb & Huttenlocher). `f` holds the
 * per-cell cost; the result is the lower envelope of the parabolas rooted at
 * each cell. Linear in `n`, which is what keeps a 512² mask off the frame
 * budget.
 */
function edt1d(f: Float64Array, n: number, out: Float64Array): void {
  // v: parabola roots in the envelope; z: where consecutive ones intersect.
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s =
      (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

/** Squared euclidean distance to the nearest cell where `inside` is true. */
function edt2d(
  inside: Uint8Array,
  w: number,
  h: number,
  want: 0 | 1,
): Float64Array {
  const INF = 1e12;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = inside[i] === want ? 0 : INF;
  }
  const col = new Float64Array(h);
  const colOut = new Float64Array(h);
  const row = new Float64Array(w);
  const rowOut = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = grid[y * w + x];
    edt1d(col, h, colOut);
    for (let y = 0; y < h; y++) grid[y * w + x] = colOut[y];
  }
  for (let y = 0; y < h; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) row[x] = grid[base + x];
    edt1d(row, w, rowOut);
    for (let x = 0; x < w; x++) grid[base + x] = rowOut[x];
  }
  return grid;
}

/**
 * A painted mask with its distance field packed alongside it.
 *
 * In: RGBA where the red channel is coverage (255 keeps a pixel, 0 erases it).
 * Out: RGBA with **red still the coverage exactly as painted** and **alpha the
 * signed distance** to the 50% contour, 0.5 sitting on the edge, above it kept
 * and below it erased.
 *
 * Both, rather than one: reconstructing coverage from a distance field gives
 * every edge the same falloff, which would harden the soft brush on the far
 * more common mask that is never animated at all. So a still mask reads red and
 * looks exactly as it was painted, and only a morph in progress reads alpha —
 * where losing the painted softness for a few frames buys a shape that moves.
 * The mask PNG is opaque, so its own alpha channel was going spare.
 */
/** Middle of a mask's erased region, or null when it erases nothing. */
export type MaskCentre = { x: number; y: number } | null;

export interface MaskField {
  /** RGBA: coverage in red, encoded signed distance in alpha. */
  data: Uint8ClampedArray;
  /**
   * Middle of the erased region, normalized to the mask. Two shapes that do not
   * overlap have to be brought onto each other before their boundaries can be
   * interpolated — lerping the fields where they are makes both shapes shrink
   * to nothing on the way, because every point is far from *both*. Morphing the
   * shape and travelling the centre are separate jobs, and this is the second.
   *
   * Null when nothing is erased, which has no middle to speak of.
   */
  centre: MaskCentre;
}

export function maskToSdf(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): MaskField {
  const n = w * h;
  const inside = new Uint8Array(n);
  // Erased is "inside the shape": that is the region whose boundary moves.
  for (let i = 0; i < n; i++) inside[i] = rgba[i * 4] < 128 ? 1 : 0;

  const toInside = edt2d(inside, w, h, 1);
  const toOutside = edt2d(inside, w, h, 0);

  let sx = 0;
  let sy = 0;
  let count = 0;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (inside[i]) {
      sx += i % w;
      sy += (i / w) | 0;
      count++;
    }
    // Positive outside the erased shape (kept), negative within it. Both legs
    // measure to the *other* region, so the contour lands between the two
    // pixels straddling it rather than on one of them.
    const d = inside[i]
      ? -Math.sqrt(toOutside[i])
      : Math.sqrt(toInside[i]);
    const enc = 0.5 + d / (2 * MASK_SDF_RANGE);
    const cov = rgba[i * 4];
    out[i * 4] = cov;
    out[i * 4 + 1] = cov;
    out[i * 4 + 2] = cov;
    out[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, enc)) * 255);
  }
  return {
    data: out,
    centre: count > 0 ? { x: sx / count / w, y: sy / count / h } : null,
  };
}

/**
 * How far the second shape's middle sits from the first's, in mask uv. What
 * the morph slides along so the two boundaries have something to interpolate
 * between; zero when either mask erases nothing.
 */
export function maskShift(
  a: MaskCentre,
  b: MaskCentre,
): { x: number; y: number } {
  if (!a || !b) return { x: 0, y: 0 };
  return { x: b.x - a.x, y: b.y - a.y };
}

/**
 * Coverage back out of an encoded distance, matching the shader's
 * reconstruction so the dialog's own preview agrees with the canvas.
 *
 * `SOFT` is the width of the rebuilt edge in mask pixels, in the region of the
 * default brush's own falloff — wide enough not to look cut out, narrow enough
 * that a blob still has an edge.
 */
const SOFT = 6;

export function sdfCoverage(enc: number): number {
  const d = (enc - 0.5) * 2 * MASK_SDF_RANGE;
  return Math.min(1, Math.max(0, d / SOFT + 0.5));
}

export const MASK_SDF_SOFT = SOFT;
