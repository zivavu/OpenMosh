// Coverage invariant for both segment timelines: a non-empty list partitions
// [0, duration] with no gaps or overlaps.

import type { BoundarySegment } from "./segment-boundary-controller.svelte";

const EPSILON = 0.001;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function differs<S extends BoundarySegment>(before: S[], after: S[]): boolean {
  if (before.length !== after.length) return true;
  for (const a of after) {
    const b = before.find((s) => s.id === a.id);
    if (!b) return true;
    if (Math.abs(b.startTime - a.startTime) > EPSILON) return true;
    const bEnd = b.endTime ?? a.endTime ?? 0;
    if (Math.abs(bEnd - (a.endTime ?? 0)) > EPSILON) return true;
  }
  return false;
}

/** Clamp into [0, duration] and re-chain; returns the input by identity when
 * it already holds, so callers can skip redundant updates. */
export function normalizeCoverage<S extends BoundarySegment>(
  segments: S[],
  duration: number,
): S[] {
  if (duration <= 0 || segments.length === 0) return segments;

  const sorted = segments
    .map((seg) => ({
      seg,
      start: clamp(seg.startTime, 0, duration),
      end: clamp(seg.endTime ?? duration, 0, duration),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const kept = sorted.filter((e) => e.end - e.start > EPSILON);
  // All out of range: stretch one over the track rather than leaving no coverage.
  const list = kept.length > 0 ? kept : [{ ...sorted[0], start: 0, end: duration }];

  const out: S[] = [];
  let cursor = 0;
  for (let i = 0; i < list.length; i++) {
    const isLast = i === list.length - 1;
    const start = out.length === 0 ? 0 : cursor;
    const end = isLast ? duration : Math.max(start, list[i].end);
    if (!isLast && end - start <= EPSILON) continue; // swallowed by an overlap
    out.push({ ...list[i].seg, startTime: start, endTime: end });
    cursor = end;
  }

  return differs(segments, out) ? out : segments;
}
