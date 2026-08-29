import { hydrateEffects, loadInitialEffects } from "../effects";
import type { EffectInstance } from "../effects/types";
import type { TextOverlayBlendMode } from "../text-overlay";
import {
  clipAt,
  clipFadeWeight,
  fitClipsToDuration,
  MIN_CLIP_LENGTH,
  sortClips,
  type TimelineClip,
} from "../timeline/clips";

export { MIN_CLIP_LENGTH } from "../timeline/clips";

/** How a layer's media is sized against the frame before its own scale. */
export type MediaFit = "contain" | "cover" | "stretch";

export const MEDIA_FIT_OPTIONS: { label: string; value: MediaFit }[] = [
  { label: "contain", value: "contain" },
  { label: "cover", value: "cover" },
  { label: "stretch", value: "stretch" },
];

/**
 * How a lane's media is placed and composited, independent of when it is on
 * screen — the media counterpart to TextStyle.
 */
export interface MediaStyle {
  /** Centre of the layer, normalized (x: left→right, y: top→bottom). */
  x: number;
  y: number;
  /** Multiplier on the fitted size. 1 = exactly the fit. */
  scale: number;
  /** Clockwise, in degrees. */
  rotation: number;
  fit: MediaFit;
  /** 0..1, applied by the GL composite. */
  opacity: number;
  blendMode: TextOverlayBlendMode;
  /**
   * Room around the media for its own effects to spread into, as a fraction of
   * the media's size on each side. A blur or a glow otherwise stops dead at the
   * media's edge, because the edge is where the layer's buffer ends.
   *
   * Paid for in resolution: the chain renders the media at 1/(1 + 2*bleed) of
   * the buffer, so a layer drawn near full-frame size softens a little. 0 is
   * the old behaviour, sharp and hard-edged; 1 gives a margin as wide as the
   * media and leaves it a third of the buffer. The buffer's own edge is the
   * ceiling either way — there is no bleed without something to spend on it.
   */
  bleed: number;
  /**
   * How much of that margin is a fade rather than a hard edge, 0..1. The room
   * bleed hands the effects still ends somewhere, and a glow cut off there
   * draws the rectangle the bleed was meant to hide; this ramps the coverage
   * out instead. Measured within the margin alone, so it never eats into the
   * media. Irrelevant, and hidden, at a bleed of 0.
   */
  bleedFade: number;
}

/** One span of media on a lane. */
export interface MediaClip extends TimelineClip {
  /** Seconds into the source the clip starts at. Ignored by image sources. */
  sourceStart: number;
  /**
   * What this clip draws, when it isn't the lane's own source. Absent means
   * "whatever the lane says", which is what every clip meant before a lane
   * could hold more than one image — so a split inherits the source the whole
   * lane was on and only the halves the user retargets carry one of these.
   *
   * The placement and the effect chain stay on the lane, so cutting a lane in
   * two and dropping a different photo on each half runs both through the
   * same chain.
   */
  sourceId?: string;
  /**
   * Fade the layer in over this many seconds from the clip's start, and out
   * over the same before its end.
   *
   * The media counterpart of FxClip.fadeSec, and for the same reason: a
   * stacked lane has no other side to cross into, so what a clip boundary
   * needs is the layer arriving rather than popping on. Here it scales the
   * lane's opacity rather than its effects' parameters.
   */
  fadeSec?: number;
}

/**
 * A media layer: a source from the pool, drawn with the lane's placement and
 * run through the lane's own effect chain before it meets the image. Clips
 * within a lane never overlap, so a lane shows at most one at a time.
 */
export interface MediaLane {
  id: string;
  name: string;
  enabled: boolean;
  /**
   * Composite before the main chain rather than over the finished frame, so
   * every image effect distorts this layer too. See TextLane.underEffects for
   * why this is a flag and not an index.
   */
  underEffects: boolean;
  /** Order among *all* layers, media and text alike. Higher sits on top. */
  z: number;
  /** Into the media pool. Null on a lane whose source was removed. */
  sourceId: string | null;
  /** Shared by every clip in the lane. */
  style: MediaStyle;
  /** Run on the layer alone, before it meets the image. */
  effects: EffectInstance[];
  clips: MediaClip[];
}

export interface MediaTimeline {
  enabled: boolean;
  lanes: MediaLane[];
}

export const DEFAULT_MEDIA_STYLE: MediaStyle = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  fit: "contain",
  opacity: 1,
  blendMode: "normal",
  bleed: 0.25,
  bleedFade: 0.5,
};

export const EMPTY_MEDIA_TIMELINE: MediaTimeline = { enabled: false, lanes: [] };

/**
 * Each live lane costs a full-frame buffer plus its own chain every frame, and
 * video lanes each hold a decoder — past a handful the preview stops keeping up
 * long before VRAM runs out.
 */
export const MAX_MEDIA_LANES = 6;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createMediaClip(
  start: number,
  end: number,
  sourceStart = 0,
  sourceId?: string,
): MediaClip {
  const clip: MediaClip = { id: nextId("mclip"), start, end, sourceStart };
  if (sourceId) clip.sourceId = sourceId;
  return clip;
}

/**
 * How strongly the clip's layer shows at `time` — 1 unless a fade is ramping.
 * Multiplied into the lane's opacity by the resolver.
 */
export function mediaClipWeight(clip: MediaClip, time: number): number {
  return clipFadeWeight(clip, clip.fadeSec, time);
}

/**
 * Cut the clip covering `at` into two. The right half picks up the source time
 * the left half reached, so splitting a video clip doesn't rewind it, and both
 * halves keep whatever source the clip was on — retargeting one of them is the
 * next gesture, not something a split should guess at.
 */
export function splitMediaClipAt(lane: MediaLane, at: number): MediaLane {
  const clip = clipAt(lane, at);
  if (!clip) return lane;
  if (at - clip.start < MIN_CLIP_LENGTH || clip.end - at < MIN_CLIP_LENGTH) {
    return lane;
  }
  return {
    ...lane,
    clips: sortClips([
      ...lane.clips.filter((c) => c.id !== clip.id),
      { ...clip, id: nextId("mclip"), end: at },
      {
        ...clip,
        id: nextId("mclip"),
        start: at,
        sourceStart: clip.sourceStart + (at - clip.start),
      },
    ]),
  };
}

export function createMediaLane(
  name: string,
  sourceId: string | null = null,
  z = 0,
  style: MediaStyle = DEFAULT_MEDIA_STYLE,
): MediaLane {
  return {
    id: nextId("mlane"),
    name,
    enabled: true,
    underEffects: false,
    z,
    sourceId,
    style: { ...style },
    // The same all-disabled list the main chain starts from, hidden effects
    // respected — an empty chain gives the panel nothing to switch on, which
    // reads as every effect being unavailable on this layer.
    effects: loadInitialEffects(),
    clips: [],
  };
}

/**
 * A new lane covering the whole timeline. A layer you can't see is a dead end —
 * the lane arrives visible, and trimming it is the opt-in step.
 */
export function createFullSpanLane(
  name: string,
  sourceId: string | null,
  duration: number,
  z = 0,
): MediaLane {
  const lane = createMediaLane(name, sourceId, z);
  const span = Math.max(duration, MIN_CLIP_LENGTH);
  return { ...lane, clips: [createMediaClip(0, span)] };
}

export function createMediaTimeline(
  sourceId: string | null,
  duration: number,
  z = 0,
): MediaTimeline {
  return {
    enabled: true,
    lanes: [createFullSpanLane("Layer 1", sourceId, duration, z)],
  };
}

/**
 * Add a lane covering the whole timeline, named after its position. `z` comes
 * from the caller: the order spans the text lanes too, which this timeline
 * can't see.
 */
export function appendMediaLane(
  timeline: MediaTimeline,
  sourceId: string | null,
  duration: number,
  z = 0,
): MediaTimeline {
  return {
    ...timeline,
    lanes: [
      ...timeline.lanes,
      createFullSpanLane(
        `Layer ${timeline.lanes.length + 1}`,
        sourceId,
        duration,
        z,
      ),
    ],
  };
}

/** A lane saved with no chain at all is backfilled, not left switch-less. */
function laneEffects(saved: unknown): EffectInstance[] {
  const hydrated = hydrateEffects(saved);
  return hydrated.length > 0 ? hydrated : loadInitialEffects();
}

function legacyChainIndex(lane: object): number {
  const raw = (lane as { chainIndex?: unknown }).chainIndex;
  return typeof raw === "number" ? raw : Number.MAX_SAFE_INTEGER;
}

/** Fill in anything a saved timeline predates or dropped. */
export function normalizeMediaTimeline(raw: unknown): MediaTimeline {
  if (!raw || typeof raw !== "object") return { ...EMPTY_MEDIA_TIMELINE };
  const t = raw as Partial<MediaTimeline>;
  const lanes = Array.isArray(t.lanes) ? t.lanes : [];
  return {
    enabled: !!t.enabled,
    lanes: lanes.map((lane, i) => ({
      id: lane.id ?? nextId("mlane"),
      name: lane.name ?? `Layer ${i + 1}`,
      enabled: lane.enabled !== false,
      // See normalizeTextTimeline: lanes saved against the old chain index
      // carry one of those instead of these two.
      underEffects: lane.underEffects ?? legacyChainIndex(lane) === 0,
      z: typeof lane.z === "number" ? lane.z : i,
      sourceId: lane.sourceId ?? null,
      style: { ...DEFAULT_MEDIA_STYLE, ...(lane.style ?? {}) },
      effects: laneEffects(lane.effects),
      clips: (Array.isArray(lane.clips) ? lane.clips : []).map((clip) => ({
        id: clip.id ?? nextId("mclip"),
        start: clip.start ?? 0,
        end: clip.end ?? 0,
        sourceStart: clip.sourceStart ?? 0,
        sourceId: clip.sourceId ?? undefined,
        fadeSec: clip.fadeSec,
      })),
    })),
  };
}

/**
 * Pull every lane's clips back inside a timeline that just got shorter. Kept by
 * identity when nothing overhangs, so the editor can run it on every duration
 * change without writing.
 */
export function fitMediaTimeline(
  timeline: MediaTimeline,
  duration: number,
): MediaTimeline {
  if (duration <= 0 || timeline.lanes.length === 0) return timeline;
  const lanes = timeline.lanes.map((lane) => fitClipsToDuration(lane, duration));
  return lanes.some((l, i) => l !== timeline.lanes[i])
    ? { ...timeline, lanes }
    : timeline;
}
