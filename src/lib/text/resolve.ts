import type { EffectInstance } from "../effects/types";
import { clipAt } from "../timeline/clips";
import type { TextLane, TextStyle, TextTimeline } from "./types";

// Clip geometry is lane-shape agnostic and shared with the sequence fx lanes;
// re-exported here so the text timeline keeps importing it from one place.
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
      effects: lane.effects,
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
    for (const eff of lane.effects) ids.push(eff.instanceId);
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
