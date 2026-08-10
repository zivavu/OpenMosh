import type { EffectInstance } from "../effects/types";
import {
  MIN_CLIP_LENGTH,
  type TextClip,
  type TextLane,
  type TextStyle,
  type TextTimeline,
} from "./types";

/** One text layer to draw for a single frame. */
export interface ResolvedTextLayer {
  /** Stable across frames: keys the renderer's texture and feedback caches. */
  key: string;
  laneId: string;
  chainIndex: number;
  text: string;
  style: TextStyle;
  effects: EffectInstance[];
}

/**
 * The text layers visible at `time`, in lane order. Preview and export both go
 * through here, so what you scrub past is what gets written out.
 */
export function resolveTextLayersAt(
  timeline: TextTimeline | null | undefined,
  time: number,
): ResolvedTextLayer[] {
  if (!timeline?.enabled) return [];
  const layers: ResolvedTextLayer[] = [];
  for (const lane of timeline.lanes) {
    if (!lane.enabled) continue;
    const clip = clipAt(lane, time);
    if (!clip || !clip.text.trim() || lane.style.opacity <= 0) continue;
    layers.push({
      key: clip.id,
      laneId: lane.id,
      chainIndex: lane.chainIndex,
      text: clip.text,
      style: lane.style,
      effects: clip.effects,
    });
  }
  return layers;
}

/** Every effect instance held anywhere in the timeline (for feedback-buffer GC). */
export function allTextEffectIds(
  timeline: TextTimeline | null | undefined,
): string[] {
  if (!timeline) return [];
  const ids: string[] = [];
  for (const lane of timeline.lanes) {
    for (const clip of lane.clips) {
      for (const eff of clip.effects) ids.push(eff.instanceId);
    }
  }
  return ids;
}

/** Fonts every clip needs, so an export can await them before frame 0. */
export function textTimelineFonts(
  timeline: TextTimeline | null | undefined,
): string[] {
  const families = new Set<string>();
  for (const lane of timeline?.lanes ?? []) {
    families.add(lane.style.fontFamily);
  }
  return [...families];
}

/**
 * The clips between two ids inclusive, in time order — a shift-click range.
 * Both must be in this lane; otherwise only `toId` is in range.
 */
export function clipRange(lane: TextLane, fromId: string, toId: string): string[] {
  const ordered = sortClips(lane.clips);
  const a = ordered.findIndex((c) => c.id === fromId);
  const b = ordered.findIndex((c) => c.id === toId);
  if (b === -1) return [];
  if (a === -1) return [toId];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return ordered.slice(lo, hi + 1).map((c) => c.id);
}

/** The clip covering `time`, or null. Clips are half-open: [start, end). */
export function clipAt(lane: TextLane, time: number): TextClip | null {
  for (const clip of lane.clips) {
    if (time >= clip.start && time < clip.end) return clip;
  }
  return null;
}

export function sortClips(clips: TextClip[]): TextClip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/**
 * The empty span around `time` on this lane, bounded by its neighbours and by
 * [0, duration]. Null when `time` already sits on a clip.
 */
export function freeRangeAt(
  lane: TextLane,
  time: number,
  duration: number,
): { start: number; end: number } | null {
  if (clipAt(lane, time)) return null;
  let start = 0;
  let end = duration;
  for (const clip of lane.clips) {
    if (clip.end <= time) start = Math.max(start, clip.end);
    if (clip.start > time) end = Math.min(end, clip.start);
  }
  return end - start >= MIN_CLIP_LENGTH ? { start, end } : null;
}

/**
 * Slide a clip to `newStart`, keeping its length and stopping at whichever
 * neighbour it runs into — a drag can't reorder or overwrite the lane.
 */
export function moveClip(
  lane: TextLane,
  clipId: string,
  newStart: number,
  duration: number,
): TextLane {
  const clip = lane.clips.find((c) => c.id === clipId);
  if (!clip) return lane;
  const length = clip.end - clip.start;
  const others = sortClips(lane.clips.filter((c) => c.id !== clipId));
  let lower = 0;
  let upper = duration;
  for (const other of others) {
    if (other.end <= clip.start) lower = Math.max(lower, other.end);
    else if (other.start >= clip.end) upper = Math.min(upper, other.start);
  }
  const start = Math.min(Math.max(newStart, lower), Math.max(lower, upper - length));
  return replaceClip(lane, { ...clip, start, end: start + length });
}

/**
 * Slide every clip in `clipIds` by `delta`, as one block. The whole group stops
 * at whichever unselected neighbour any member runs into, so the selection
 * keeps its internal spacing and still can't overwrite anything. Ids belonging
 * to other lanes are ignored.
 */
export function moveClips(
  lane: TextLane,
  clipIds: string[],
  delta: number,
  duration: number,
): TextLane {
  const ids = new Set(clipIds);
  const moving = lane.clips.filter((c) => ids.has(c.id));
  if (moving.length === 0) return lane;
  const fixed = lane.clips.filter((c) => !ids.has(c.id));

  // The tightest limit any one member imposes governs the whole group.
  let lower = -Infinity;
  let upper = Infinity;
  for (const clip of moving) {
    lower = Math.max(lower, -clip.start);
    upper = Math.min(upper, duration - clip.end);
    for (const other of fixed) {
      if (other.end <= clip.start) lower = Math.max(lower, other.end - clip.start);
      else if (other.start >= clip.end) upper = Math.min(upper, other.start - clip.end);
    }
  }
  if (lower > upper) return lane;

  const step = Math.min(Math.max(delta, lower), upper);
  if (step === 0) return lane;
  return {
    ...lane,
    clips: sortClips(
      lane.clips.map((c) =>
        ids.has(c.id) ? { ...c, start: c.start + step, end: c.end + step } : c,
      ),
    ),
  };
}

/**
 * Drag one edge. The clip keeps at least MIN_CLIP_LENGTH and stops at its
 * neighbours, so edges can meet but never cross — dragging one edge alone
 * pulls it away from a flush neighbour, leaving a gap.
 */
export function resizeClip(
  lane: TextLane,
  clipId: string,
  edge: "start" | "end",
  time: number,
  duration: number,
): TextLane {
  const clip = lane.clips.find((c) => c.id === clipId);
  if (!clip) return lane;
  const others = sortClips(lane.clips.filter((c) => c.id !== clipId));
  if (edge === "start") {
    let lower = 0;
    for (const other of others) {
      if (other.end <= clip.start) lower = Math.max(lower, other.end);
    }
    const start = Math.min(
      Math.max(time, lower),
      clip.end - MIN_CLIP_LENGTH,
    );
    return replaceClip(lane, { ...clip, start });
  }
  let upper = duration;
  for (const other of others) {
    if (other.start >= clip.end) upper = Math.min(upper, other.start);
  }
  const end = Math.max(Math.min(time, upper), clip.start + MIN_CLIP_LENGTH);
  return replaceClip(lane, { ...clip, end });
}

/**
 * Drag the edge shared by two flush clips: both clips' facing edges move to
 * `time`, each keeping at least MIN_CLIP_LENGTH.
 */
export function resizeBoundary(
  lane: TextLane,
  leftId: string,
  rightId: string,
  time: number,
): TextLane {
  const left = lane.clips.find((c) => c.id === leftId);
  const right = lane.clips.find((c) => c.id === rightId);
  if (!left || !right) return lane;
  const t = Math.max(
    left.start + MIN_CLIP_LENGTH,
    Math.min(time, right.end - MIN_CLIP_LENGTH),
  );
  return {
    ...lane,
    clips: sortClips(
      lane.clips.map((c) =>
        c.id === left.id
          ? { ...left, end: t }
          : c.id === right.id
            ? { ...right, start: t }
            : c,
      ),
    ),
  };
}

/** Add a clip, trimmed to the free span it lands in. Returns the lane unchanged
 * when there is no room. */
export function addClip(
  lane: TextLane,
  clip: TextClip,
  duration: number,
): TextLane {
  const range = freeRangeAt(lane, clip.start, duration);
  if (!range) return lane;
  const start = Math.max(clip.start, range.start);
  const end = Math.min(clip.end, range.end);
  if (end - start < MIN_CLIP_LENGTH) return lane;
  return { ...lane, clips: sortClips([...lane.clips, { ...clip, start, end }]) };
}

export function removeClip(lane: TextLane, clipId: string): TextLane {
  return { ...lane, clips: lane.clips.filter((c) => c.id !== clipId) };
}

function replaceClip(lane: TextLane, clip: TextClip): TextLane {
  return {
    ...lane,
    clips: sortClips(lane.clips.map((c) => (c.id === clip.id ? clip : c))),
  };
}

/** Apply a lane edit inside a timeline. */
export function updateLane(
  timeline: TextTimeline,
  laneId: string,
  fn: (lane: TextLane) => TextLane,
): TextTimeline {
  return {
    ...timeline,
    lanes: timeline.lanes.map((l) => (l.id === laneId ? fn(l) : l)),
  };
}

/** Snap to a grid (beat or second). `grid <= 0` snaps to nothing. */
export function snapTime(time: number, grid: number): number {
  if (grid <= 0) return time;
  return Math.round(time / grid) * grid;
}
