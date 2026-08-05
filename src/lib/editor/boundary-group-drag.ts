// Dragging a multi-boundary selection as one unit, shared by both timelines.

import type { BoundarySegment } from "./segment-boundary-controller.svelte";

const EPSILON = 0.001;

export interface GroupBoundary {
  time: number;
  leftSegId: string | null;
  rightSegId: string | null;
}

function isSelected(times: number[], t: number): boolean {
  return times.some((s) => Math.abs(s - t) < EPSILON);
}

/** The selected boundaries, each resolved to the segments it joins. */
export function collectGroupBoundaries<S extends BoundarySegment>(
  segments: S[],
  selectedTimes: number[],
  duration: number,
): GroupBoundary[] {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  return selectedTimes.map((t) => {
    const left = sorted.find((s) => {
      const end = s.endTime ?? duration;
      return Math.abs(end - t) < EPSILON && end < duration - EPSILON;
    });
    const right = sorted.find(
      (s) => Math.abs(s.startTime - t) < EPSILON && s.startTime > EPSILON,
    );
    return { time: t, leftSegId: left?.id ?? null, rightSegId: right?.id ?? null };
  });
}

/** Boundary times that stay put, including the track ends. */
export function nonSelectedBoundaryTimes<S extends BoundarySegment>(
  segments: S[],
  selectedTimes: number[],
  duration: number,
): number[] {
  const all = new Set<number>([0, duration]);
  for (const s of segments) {
    if (s.startTime > EPSILON) all.add(s.startTime);
    const end = s.endTime ?? duration;
    if (end < duration - EPSILON) all.add(end);
  }
  return [...all]
    .filter((b) => !isSelected(selectedTimes, b))
    .sort((a, b) => a - b);
}

/** Clamp so no dragged boundary crosses a fixed neighbour or leaves the track. */
export function clampGroupDelta(
  rawDelta: number,
  group: GroupBoundary[],
  nonSelected: number[],
  duration: number,
  minSegment: number,
): number {
  let minDelta = -Infinity;
  let maxDelta = Infinity;
  for (const b of group) {
    minDelta = Math.max(minDelta, minSegment - b.time);
    maxDelta = Math.min(maxDelta, duration - minSegment - b.time);
    for (let i = nonSelected.length - 1; i >= 0; i--) {
      if (nonSelected[i] < b.time - EPSILON) {
        minDelta = Math.max(minDelta, nonSelected[i] + minSegment - b.time);
        break;
      }
    }
    for (let i = 0; i < nonSelected.length; i++) {
      if (nonSelected[i] > b.time + EPSILON) {
        maxDelta = Math.min(maxDelta, nonSelected[i] - minSegment - b.time);
        break;
      }
    }
  }
  if (minDelta > maxDelta) return 0;
  return Math.max(minDelta, Math.min(maxDelta, rawDelta));
}

/** Per-segment time patches for moving the whole group by `delta`. */
export function groupDeltaUpdates(
  group: GroupBoundary[],
  delta: number,
): Record<string, { startTime?: number; endTime?: number }> {
  const updates: Record<string, { startTime?: number; endTime?: number }> = {};
  for (const b of group) {
    const t = b.time + delta;
    if (b.leftSegId) updates[b.leftSegId] = { ...updates[b.leftSegId], endTime: t };
    if (b.rightSegId)
      updates[b.rightSegId] = { ...updates[b.rightSegId], startTime: t };
  }
  return updates;
}

/** Where the dragged boundaries ended up, for refreshing the selection. */
export function groupBoundaryTimesAfter<S extends BoundarySegment>(
  group: GroupBoundary[],
  segments: S[],
  duration: number,
): number[] {
  const times: number[] = [];
  for (const b of group) {
    const seg = segments.find((s) => s.id === (b.leftSegId ?? b.rightSegId));
    if (!seg) continue;
    times.push(b.leftSegId ? (seg.endTime ?? duration) : seg.startTime);
  }
  return times;
}
