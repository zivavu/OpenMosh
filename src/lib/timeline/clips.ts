/**
 * Clip geometry shared by every lane that holds free-floating, non-overlapping
 * spans: the text lanes and the sequence fx lanes. Nothing here knows what a
 * clip *carries* — only where it sits — so both callers get the same drag,
 * resize and gap-finding behaviour without a second copy of the math.
 *
 * Contrast with segment-coverage.ts, which holds the opposite invariant: the
 * source lane partitions [0, duration] with no gaps, because every frame has to
 * come from somewhere. A lane of clips is allowed to be empty.
 */

/** Shortest clip a lane will create or leave behind after a resize. */
export const MIN_CLIP_LENGTH = 0.05;

export interface TimelineClip {
  id: string;
  /** Seconds on the mode's master timeline. */
  start: number;
  end: number;
}

export interface ClipLane<C extends TimelineClip> {
  clips: C[];
}

export function sortClips<C extends TimelineClip>(clips: C[]): C[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/** The clip covering `time`, or null. Clips are half-open: [start, end). */
export function clipAt<C extends TimelineClip>(
  lane: ClipLane<C>,
  time: number,
): C | null {
  for (const clip of lane.clips) {
    if (time >= clip.start && time < clip.end) return clip;
  }
  return null;
}

/**
 * The clips between two ids inclusive, in time order — a shift-click range.
 * Both must be in this lane; otherwise only `toId` is in range.
 */
export function clipRange<C extends TimelineClip>(
  lane: ClipLane<C>,
  fromId: string,
  toId: string,
): string[] {
  const ordered = sortClips(lane.clips);
  const a = ordered.findIndex((c) => c.id === fromId);
  const b = ordered.findIndex((c) => c.id === toId);
  if (b === -1) return [];
  if (a === -1) return [toId];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return ordered.slice(lo, hi + 1).map((c) => c.id);
}

/**
 * The empty span around `time` on this lane, bounded by its neighbours and by
 * [0, duration]. Null when `time` already sits on a clip.
 */
export function freeRangeAt<C extends TimelineClip>(
  lane: ClipLane<C>,
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
export function moveClip<C extends TimelineClip, L extends ClipLane<C>>(
  lane: L,
  clipId: string,
  newStart: number,
  duration: number,
): L {
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
export function moveClips<C extends TimelineClip, L extends ClipLane<C>>(
  lane: L,
  clipIds: string[],
  delta: number,
  duration: number,
): L {
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
export function resizeClip<C extends TimelineClip, L extends ClipLane<C>>(
  lane: L,
  clipId: string,
  edge: "start" | "end",
  time: number,
  duration: number,
): L {
  const clip = lane.clips.find((c) => c.id === clipId);
  if (!clip) return lane;
  const others = sortClips(lane.clips.filter((c) => c.id !== clipId));
  if (edge === "start") {
    let lower = 0;
    for (const other of others) {
      if (other.end <= clip.start) lower = Math.max(lower, other.end);
    }
    const start = Math.min(Math.max(time, lower), clip.end - MIN_CLIP_LENGTH);
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
export function resizeBoundary<C extends TimelineClip, L extends ClipLane<C>>(
  lane: L,
  leftId: string,
  rightId: string,
  time: number,
): L {
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

/**
 * Add a clip, trimmed to the free span it lands in. Returns the lane unchanged
 * when there is no room.
 */
export function addClip<C extends TimelineClip, L extends ClipLane<C>>(
  lane: L,
  clip: C,
  duration: number,
): L {
  const range = freeRangeAt(lane, clip.start, duration);
  if (!range) return lane;
  const start = Math.max(clip.start, range.start);
  const end = Math.min(clip.end, range.end);
  if (end - start < MIN_CLIP_LENGTH) return lane;
  return { ...lane, clips: sortClips([...lane.clips, { ...clip, start, end }]) };
}

export function removeClip<C extends TimelineClip, L extends ClipLane<C>>(
  lane: L,
  clipId: string,
): L {
  return { ...lane, clips: lane.clips.filter((c) => c.id !== clipId) };
}

function replaceClip<C extends TimelineClip, L extends ClipLane<C>>(
  lane: L,
  clip: C,
): L {
  return {
    ...lane,
    clips: sortClips(lane.clips.map((c) => (c.id === clip.id ? clip : c))),
  };
}

/** Apply a lane edit inside a list of lanes. */
export function updateLaneIn<L extends { id: string }>(
  lanes: L[],
  laneId: string,
  fn: (lane: L) => L,
): L[] {
  return lanes.map((l) => (l.id === laneId ? fn(l) : l));
}
