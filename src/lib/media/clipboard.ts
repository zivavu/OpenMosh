/**
 * Copy/paste for media layer clips.
 *
 * A clip carries its span, its in-point and whichever source it was retargeted
 * to. The placement and the effect chain live on the lane and are shared by
 * every clip on it, so a copy pastes back into the lane it came from, where
 * both come along by themselves. Pasting onto another lane would mean
 * overwriting that lane's chain for the sake of one clip, which is a lane edit
 * wearing a clip's clothes.
 */

import { sortClips } from "../timeline/clips";
import { createMediaClip, type MediaClip, type MediaLane } from "./types";
import type { MediaTimeline } from "./types";

/** Sub-frame slop, so a clip butted against its neighbour still counts as free. */
const EPSILON = 1e-6;

/** One copied clip, placed relative to the earliest one in the copy. */
export interface MediaClipboardEntry {
  laneId: string;
  /** Seconds from the copy anchor. */
  offset: number;
  length: number;
  sourceStart: number;
  /** The clip's own source, when it had one; absent means the lane's. */
  sourceId?: string;
  fadeSec?: number;
}

/** Snapshot the given clips, anchored at the earliest one's start. */
export function copyMediaClips(
  timeline: MediaTimeline,
  clipIds: string[],
): MediaClipboardEntry[] {
  const ids = new Set(clipIds);
  const found: MediaClipboardEntry[] = [];
  let anchor = Infinity;
  for (const lane of timeline.lanes) {
    for (const clip of lane.clips) {
      if (!ids.has(clip.id)) continue;
      anchor = Math.min(anchor, clip.start);
      found.push({
        laneId: lane.id,
        offset: clip.start,
        length: clip.end - clip.start,
        sourceStart: clip.sourceStart,
        sourceId: clip.sourceId,
        fadeSec: clip.fadeSec,
      });
    }
  }
  if (found.length === 0) return [];
  return found
    .map((e) => ({ ...e, offset: e.offset - anchor }))
    .sort((a, b) => a.offset - b.offset);
}

/** Room for [start, end) on this lane, with nothing already there. */
function fits(
  lane: MediaLane,
  start: number,
  end: number,
  duration: number,
): boolean {
  if (start < -EPSILON || end > duration + EPSILON) return false;
  for (const c of lane.clips) {
    if (start < c.end - EPSILON && end > c.start + EPSILON) return false;
  }
  return true;
}

/**
 * How far the whole block has to slide right to land clear of everything, or
 * null when it never does.
 *
 * Only the ends of the clips in the way are worth trying: between two of them
 * nothing changes about what blocks what, so the first delta that works is one
 * that puts some entry flush against the clip it was overlapping.
 */
function firstFreeDelta(
  entries: MediaClipboardEntry[],
  lanes: Map<string, MediaLane>,
  at: number,
  duration: number,
): number | null {
  const candidates = new Set<number>([0]);
  for (const e of entries) {
    for (const c of lanes.get(e.laneId)!.clips) {
      const delta = c.end - (at + e.offset);
      if (delta > 0) candidates.add(delta);
    }
  }
  for (const delta of [...candidates].sort((a, b) => a - b)) {
    const clear = entries.every((e) => {
      const start = at + e.offset + delta;
      return fits(lanes.get(e.laneId)!, start, start + e.length, duration);
    });
    if (clear) return delta;
  }
  return null;
}

export interface MediaPasteResult {
  timeline: MediaTimeline;
  /** The clips that landed, for the caller to select. Empty on a no-op. */
  clipIds: string[];
}

/**
 * Stamp the clipboard down with its earliest clip at `at`.
 *
 * Lanes can't hold overlapping clips, and trimming the paste to whatever gap it
 * happened to land in would quietly hand back a shorter clip than the one that
 * was copied. Instead the whole block slides right to the first place it fits
 * at full length, so pasting with the playhead inside the original drops the
 * copy directly after it. When nothing downstream has room, nothing is pasted.
 */
export function pasteMediaClips(
  timeline: MediaTimeline,
  entries: MediaClipboardEntry[],
  at: number,
  duration: number,
): MediaPasteResult {
  const unchanged: MediaPasteResult = { timeline, clipIds: [] };
  if (entries.length === 0 || duration <= 0) return unchanged;

  const lanes = new Map(timeline.lanes.map((l) => [l.id, l]));
  // A lane deleted since the copy takes its clips with it.
  const live = entries.filter((e) => lanes.has(e.laneId));
  if (live.length === 0) return unchanged;

  const delta = firstFreeDelta(live, lanes, Math.max(0, at), duration);
  if (delta === null) return unchanged;

  const added = new Map<string, MediaClip[]>();
  const clipIds: string[] = [];
  for (const e of live) {
    const start = Math.max(0, at) + e.offset + delta;
    const clip = createMediaClip(
      start,
      start + e.length,
      e.sourceStart,
      e.sourceId,
    );
    if (e.fadeSec !== undefined) clip.fadeSec = e.fadeSec;
    clipIds.push(clip.id);
    const list = added.get(e.laneId);
    if (list) list.push(clip);
    else added.set(e.laneId, [clip]);
  }

  return {
    timeline: {
      ...timeline,
      lanes: timeline.lanes.map((lane) => {
        const list = added.get(lane.id);
        return list ? { ...lane, clips: sortClips([...lane.clips, ...list]) } : lane;
      }),
    },
    clipIds,
  };
}
