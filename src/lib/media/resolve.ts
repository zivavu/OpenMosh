import type { EffectInstance } from "../effects/types";
import { clipAt } from "../timeline/clips";
import {
  mediaClipWeight,
  type MediaClip,
  type MediaLane,
  type MediaStyle,
  type MediaTimeline,
} from "./types";

// Clip geometry is lane-shape agnostic and shared with the text and fx lanes;
// re-exported here so the media timeline keeps importing it from one place.
export {
  addClip,
  clipAt,
  clipRange,
  freeRangeAt,
  moveClip,
  moveClips,
  removeClip,
  resizeBoundary,
  resizeClip,
  sortClips,
} from "../timeline/clips";

/** One media layer to draw for a single frame. */
export interface ResolvedMediaLayer {
  /**
   * Stable across frames: keys the renderer's layer texture and the lane's
   * feedback buffers. The lane, not the clip — one texture per lane is all a
   * lane can show at once, and re-keying at every clip edge would drop the
   * texture on a cut the user can't see the point of.
   */
  key: string;
  laneId: string;
  /** Composite before the whole chain, or over the finished frame. */
  underEffects: boolean;
  /** Order among all layers, media and text alike. Higher sits on top. */
  z: number;
  sourceId: string;
  /** Seconds into the source to show. Videos wrap; images ignore it. */
  sourceTime: number;
  style: MediaStyle;
  /**
   * What the composite draws this layer at: the lane's opacity, scaled by the
   * clip's fade while one is ramping. Separate from `style.opacity` so the
   * per-frame value never has to clone the lane's style.
   */
  opacity: number;
  effects: EffectInstance[];
}

/**
 * What a clip draws: its own source when it was retargeted, the lane's
 * otherwise. Every read of a clip's media goes through here — a clip pointing
 * at a source that has since left the pool is the caller's problem, the same
 * as a lane's.
 */
export function clipSourceId(
  lane: MediaLane,
  clip: MediaClip | null | undefined,
): string | null {
  return clip?.sourceId ?? lane.sourceId;
}

/** Distinct sources a lane's clips can call for, the lane's own included. */
export function laneSourceIds(lane: MediaLane): string[] {
  const ids = new Set<string>();
  for (const clip of lane.clips) {
    const id = clipSourceId(lane, clip);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * The media layers visible at `time`, in lane order. Preview and export both
 * go through here, so what you scrub past is what gets written out.
 */
export function resolveMediaLayersAt(
  timeline: MediaTimeline | null | undefined,
  time: number,
): ResolvedMediaLayer[] {
  if (!timeline?.enabled) return [];
  const layers: ResolvedMediaLayer[] = [];
  for (const lane of timeline.lanes) {
    if (!lane.enabled || lane.style.opacity <= 0) continue;
    const clip = clipAt(lane, time);
    if (!clip) continue;
    const sourceId = clipSourceId(lane, clip);
    if (!sourceId) continue;
    layers.push({
      key: lane.id,
      laneId: lane.id,
      underEffects: lane.underEffects,
      z: lane.z,
      sourceId,
      sourceTime: clip.sourceStart + (time - clip.start),
      style: lane.style,
      opacity: lane.style.opacity * mediaClipWeight(clip, time),
      effects: lane.effects,
    });
  }
  return layers;
}

/** The clip with this id, wherever it sits. Null when nothing is selected. */
export function findMediaClip(
  timeline: MediaTimeline | null | undefined,
  clipId: string | null,
): MediaClip | null {
  if (!clipId || !timeline) return null;
  for (const lane of timeline.lanes) {
    const clip = lane.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

/** The lane holding this clip — the panel edits the lane, not the clip. */
export function findMediaClipLane(
  timeline: MediaTimeline | null | undefined,
  clipId: string | null,
): MediaLane | null {
  if (!clipId || !timeline) return null;
  return timeline.lanes.find((l) => l.clips.some((c) => c.id === clipId)) ?? null;
}

/** Every effect instance held anywhere (for feedback-buffer GC). */
export function allMediaEffectIds(
  timeline: MediaTimeline | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const lane of timeline?.lanes ?? []) {
    for (const eff of lane.effects) ids.push(eff.instanceId);
  }
  return ids;
}

/** Source ids the timeline references, so a save can persist just those. */
export function mediaTimelineSourceIds(
  timeline: MediaTimeline | null | undefined,
): string[] {
  const ids = new Set<string>();
  for (const lane of timeline?.lanes ?? []) {
    if (lane.sourceId) ids.add(lane.sourceId);
    for (const clip of lane.clips) {
      if (clip.sourceId) ids.add(clip.sourceId);
    }
  }
  return [...ids];
}

/**
 * Point the given clips at `sourceId`. A clip already on its lane's source
 * keeps no override, so the lane's own picker still moves it — that is what
 * "this lane's default" has to keep meaning for the clips that never chose.
 */
export function setMediaClipSources(
  timeline: MediaTimeline,
  clipIds: string[],
  sourceId: string,
): MediaTimeline {
  const ids = new Set(clipIds);
  if (ids.size === 0) return timeline;
  return {
    ...timeline,
    lanes: timeline.lanes.map((lane) => {
      if (!lane.clips.some((c) => ids.has(c.id))) return lane;
      return {
        ...lane,
        clips: lane.clips.map((c) =>
          ids.has(c.id)
            ? {
                ...c,
                sourceId: sourceId === lane.sourceId ? undefined : sourceId,
              }
            : c,
        ),
      };
    }),
  };
}

/** Apply a lane edit inside a timeline. */
export function updateMediaLane(
  timeline: MediaTimeline,
  laneId: string,
  fn: (lane: MediaLane) => MediaLane,
): MediaTimeline {
  return {
    ...timeline,
    lanes: timeline.lanes.map((l) => (l.id === laneId ? fn(l) : l)),
  };
}

/**
 * Drop a removed source from every lane and clip that pointed at it. A clip
 * loses its override rather than gaining a null one, so it falls back to its
 * lane the way an untouched clip does.
 */
export function detachMediaSource(
  timeline: MediaTimeline,
  sourceId: string,
): MediaTimeline {
  const held = (l: MediaLane) =>
    l.sourceId === sourceId || l.clips.some((c) => c.sourceId === sourceId);
  if (!timeline.lanes.some(held)) return timeline;
  return {
    ...timeline,
    lanes: timeline.lanes.map((l) => {
      if (!held(l)) return l;
      return {
        ...l,
        sourceId: l.sourceId === sourceId ? null : l.sourceId,
        clips: l.clips.map((c) =>
          c.sourceId === sourceId ? { ...c, sourceId: undefined } : c,
        ),
      };
    }),
  };
}
