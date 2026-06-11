import type { SalPoint, TrackingParams } from "./types";

/** Convert a row-major RGBA buffer (top-first) to a 0..1 luminance grid. */
export function lumFromRGBA(rgba: Uint8Array, n: number): Float32Array {
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return lum;
}

/**
 * Cheap content-aware saliency: from a small downsampled luminance grid, score
 * each cell by edge magnitude (Sobel) plus deviation from the mean brightness,
 * then greedily pick the strongest cells with spatial spacing so the boxes
 * don't clump. Returns points in normalized coords (y: top→bottom).
 *
 * `lum` is row-major starting at the image TOP (the caller reads the framebuffer
 * such that row 0 == top of the image), so normalized y = row / (gh - 1).
 */
export function computeSaliency(
  lum: Float32Array,
  gw: number,
  gh: number,
  params: TrackingParams,
): SalPoint[] {
  const n = gw * gh;
  if (n === 0) return [];

  let mean = 0;
  for (let i = 0; i < n; i++) mean += lum[i];
  mean /= n;

  // Score = Sobel edge magnitude + brightness deviation from the mean.
  const score = new Float32Array(n);
  const at = (x: number, y: number) => lum[y * gw + x];
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const gx =
        -at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1) +
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1) +
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1);
      const edge = Math.sqrt(gx * gx + gy * gy);
      const dev = Math.abs(lum[y * gw + x] - mean);
      score[y * gw + x] = edge + dev * 0.6;
    }
  }

  // Collect candidates above a sensitivity-scaled threshold.
  let maxScore = 0;
  for (let i = 0; i < n; i++) if (score[i] > maxScore) maxScore = score[i];
  if (maxScore <= 0) return [];
  const threshold = maxScore * (0.08 + params.sensitivity * 0.32);

  const candidates: SalPoint[] = [];
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const s = score[y * gw + x];
      if (s < threshold) continue;
      candidates.push({ x: x / (gw - 1), y: y / (gh - 1), score: s });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // Greedy non-maximum suppression: keep strong points that are far enough apart.
  // Higher sensitivity packs boxes tighter; lower spreads them out.
  const minDist = (0.18 - params.sensitivity * 0.1) * (1 + 4 / params.count);
  const minDist2 = minDist * minDist;
  const picked: SalPoint[] = [];
  for (const c of candidates) {
    if (picked.length >= params.count) break;
    let ok = true;
    for (const p of picked) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (dx * dx + dy * dy < minDist2) {
        ok = false;
        break;
      }
    }
    if (ok) picked.push(c);
  }

  return picked;
}
