// Copy/paste of segment content — the boundary clipboard only moves splits.

import { cloneEffectInstance, generateId } from "../effects";
import type { SequenceSegment } from "./sequence";

/** Everything defining how a segment behaves, minus its identity and time span. */
export type SegmentContent = Omit<
  SequenceSegment,
  "id" | "startTime" | "endTime"
>;

export interface SegmentClip {
  /** Seconds from the copy anchor (the earliest copied segment's start). */
  offsetStart: number;
  offsetEnd: number;
  content: SegmentContent;
}

/** Shorter than a paste is treated as a degenerate span and skipped. */
const MIN_CLIP_DURATION = 0.02;

export function captureContent(seg: SequenceSegment): SegmentContent {
  const { id: _id, startTime: _s, endTime: _e, ...content } = seg;
  return { ...content, effects: content.effects.map(cloneEffectInstance) };
}

/** Overwrite a segment's content, keeping its identity and time span. */
export function applyContent(
  seg: SequenceSegment,
  content: SegmentContent,
): SequenceSegment {
  return {
    ...content,
    effects: content.effects.map(cloneEffectInstance),
    id: seg.id,
    startTime: seg.startTime,
    endTime: seg.endTime,
  };
}

/** Snapshot the selected segments, anchored at the earliest one's start. */
export function copySegments(
  selected: SequenceSegment[],
  duration: number,
): SegmentClip[] {
  if (selected.length === 0) return [];
  const sorted = [...selected].sort((a, b) => a.startTime - b.startTime);
  const anchor = sorted[0].startTime;
  return sorted.map((seg) => ({
    offsetStart: seg.startTime - anchor,
    offsetEnd: (seg.endTime ?? duration) - anchor,
    content: captureContent(seg),
  }));
}

/** Replace [start, end) with one segment, trimming whatever it overlaps. */
function stampRegion(
  segments: SequenceSegment[],
  start: number,
  end: number,
  content: SegmentContent,
  duration: number,
): SequenceSegment[] {
  const out: SequenceSegment[] = [];
  for (const s of segments) {
    const sStart = s.startTime;
    const sEnd = s.endTime ?? duration;
    if (sEnd <= start + 0.001 || sStart >= end - 0.001) {
      out.push(s);
    } else if (sStart >= start - 0.001 && sEnd <= end + 0.001) {
      // Fully covered — drop it.
    } else if (sStart < start && sEnd > end) {
      // Stamped inside one segment: head + tail, the tail re-entering mid-stream.
      out.push({ ...s, endTime: start });
      out.push({
        ...s,
        id: generateId(),
        startTime: end,
        endTime: s.endTime,
        effects: s.effects.map(cloneEffectInstance),
        transition: undefined,
        transitionOnTick: undefined,
      });
    } else if (sStart < start) {
      out.push({ ...s, endTime: start });
    } else {
      out.push({ ...s, startTime: end });
    }
  }
  out.push({
    ...content,
    effects: content.effects.map(cloneEffectInstance),
    id: generateId(),
    startTime: start,
    endTime: end,
  });
  return out.sort((a, b) => a.startTime - b.startTime);
}

/** Stamp clips with the earliest one starting at `anchorTime`. */
export function pasteClipsAt(
  segments: SequenceSegment[],
  clips: SegmentClip[],
  anchorTime: number,
  duration: number,
): SequenceSegment[] {
  if (segments.length === 0 || clips.length === 0) return segments;
  let out = [...segments];
  for (const clip of clips) {
    const start = Math.max(0, anchorTime + clip.offsetStart);
    const end = Math.min(duration, anchorTime + clip.offsetEnd);
    if (end - start < MIN_CLIP_DURATION) continue;
    out = stampRegion(out, start, end, clip.content, duration);
  }
  return out;
}

/** Overwrite targets in place, keeping their spans; clips repeat if fewer. */
export function pasteContentOnto(
  segments: SequenceSegment[],
  targetIds: string[],
  clips: SegmentClip[],
): SequenceSegment[] {
  if (clips.length === 0 || targetIds.length === 0) return segments;
  const targets = new Set(targetIds);
  const order = [...segments]
    .filter((s) => targets.has(s.id))
    .sort((a, b) => a.startTime - b.startTime)
    .map((s) => s.id);
  return segments.map((s) => {
    const i = order.indexOf(s.id);
    return i === -1 ? s : applyContent(s, clips[i % clips.length].content);
  });
}
