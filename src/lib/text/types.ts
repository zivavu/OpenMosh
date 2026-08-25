import { hydrateEffects } from "../effects";
import type { EffectInstance } from "../effects/types";
// Straight from the module, not the barrel: that re-exports the custom-font
// store, whose runes can't run outside a Svelte build — which took this file's
// tests down with it.
import { FONT_OPTIONS } from "../text-overlay/fonts";
import type { TextOverlayBlendMode } from "../text-overlay/types";
import {
  clipAt,
  MIN_CLIP_LENGTH,
  sortClips,
  type TimelineClip,
} from "../timeline/clips";

export type TextAlign = "left" | "center" | "right";

export { MIN_CLIP_LENGTH } from "../timeline/clips";

/** How a lane's text is drawn, independent of when it is on screen. */
export interface TextStyle {
  /** Anchor position, normalized (x: left→right, y: top→bottom). */
  x: number;
  y: number;
  /** Font size as a fraction of frame height. */
  size: number;
  /** CSS font-family value (see text-overlay/fonts.ts). */
  fontFamily: string;
  /** Which side of the anchor the text sits on. */
  align: TextAlign;
  color: string;
  outline: boolean;
  outlineColor: string;
  /** Stroke width, in px at a 720px reference height (scaled to actual size). */
  outlineWidth: number;
  /** 0..1, applied by the GL composite rather than the 2D canvas. */
  opacity: number;
  blendMode: TextOverlayBlendMode;
}

/** One span of text on a lane. */
export interface TextClip extends TimelineClip {
  text: string;
}

/**
 * A text layer. Clips within a lane never overlap, so a lane shows at most one
 * clip at a time and drag/resize stay unambiguous.
 */
export interface TextLane {
  id: string;
  name: string;
  enabled: boolean;
  /**
   * Composite before the main chain rather than over the finished frame, so
   * every image effect distorts this layer too.
   *
   * This replaced an index into the enabled effects: only its two ends meant
   * anything stable, since toggling an effect, reordering the chain or rolling
   * a mosh renumbers everything in between.
   */
  underEffects: boolean;
  /** Order among *all* layers, text and media alike. Higher sits on top. */
  z: number;
  /** Shared by every clip in the lane. */
  style: TextStyle;
  /** Run on the lane's text alone, before it meets the image. Shared by every
   * clip in the lane, like the style is. */
  effects: EffectInstance[];
  clips: TextClip[];
}

export interface TextTimeline {
  enabled: boolean;
  lanes: TextLane[];
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  x: 0.5,
  y: 0.5,
  size: 0.1,
  fontFamily: FONT_OPTIONS[0].family,
  align: "center",
  color: "#ffffff",
  outline: true,
  outlineColor: "#000000",
  outlineWidth: 2,
  opacity: 1,
  blendMode: "normal",
};

export const EMPTY_TEXT_TIMELINE: TextTimeline = { enabled: false, lanes: [] };

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createTextClip(start: number, end: number, text = ""): TextClip {
  return { id: nextId("clip"), start, end, text };
}

/**
 * Cut the clip covering `at` into two, each keeping the text. Returns the lane
 * unchanged when `at` isn't inside a clip, or when either half would come out
 * shorter than MIN_CLIP_LENGTH.
 */
export function splitTextClipAt(lane: TextLane, at: number): TextLane {
  const clip = clipAt(lane, at);
  if (!clip) return lane;
  if (at - clip.start < MIN_CLIP_LENGTH || clip.end - at < MIN_CLIP_LENGTH) {
    return lane;
  }
  return {
    ...lane,
    clips: sortClips([
      ...lane.clips.filter((c) => c.id !== clip.id),
      { ...clip, id: nextId("clip"), end: at },
      { ...clip, id: nextId("clip"), start: at },
    ]),
  };
}

export function createTextLane(
  name: string,
  z = 0,
  style: TextStyle = DEFAULT_TEXT_STYLE,
): TextLane {
  return {
    id: nextId("lane"),
    name,
    enabled: true,
    underEffects: false,
    z,
    style: { ...style },
    effects: [],
    clips: [],
  };
}

export function createTextTimeline(z = TEXT_Z_BASE): TextTimeline {
  return { enabled: true, lanes: [createTextLane("Text 1", z)] };
}

/**
 * Add an empty lane, named after its position. `z` comes from the caller: the
 * order spans the media lanes too, and this timeline can't see those.
 */
export function appendTextLane(
  timeline: TextTimeline,
  z = TEXT_Z_BASE,
): TextTimeline {
  return {
    ...timeline,
    lanes: [
      ...timeline.lanes,
      createTextLane(`Text ${timeline.lanes.length + 1}`, z),
    ],
  };
}

/**
 * Where text lanes start in the shared layer order. Above the media lanes,
 * which is where they sat before the two orders were merged — and where a
 * caption over a layered clip wants to be anyway.
 */
export const TEXT_Z_BASE = 1000;

function legacyChainIndex(lane: object): number {
  const raw = (lane as { chainIndex?: unknown }).chainIndex;
  return typeof raw === "number" ? raw : Number.MAX_SAFE_INTEGER;
}

/** Fill in anything a saved timeline predates or dropped. */
export function normalizeTextTimeline(raw: unknown): TextTimeline {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TEXT_TIMELINE };
  const t = raw as Partial<TextTimeline>;
  const lanes = Array.isArray(t.lanes) ? t.lanes : [];
  return {
    enabled: !!t.enabled,
    lanes: lanes.map((lane, i) => {
      const clips = Array.isArray(lane.clips) ? lane.clips : [];
      // Timelines saved before styles moved to the lane carried one per
      // clip; the first clip's style stands in for the lane's.
      const legacyStyle = (clips as Array<{ style?: TextStyle }>).find(
        (c) => c.style,
      )?.style;
      return {
        id: lane.id ?? nextId("lane"),
        name: lane.name ?? `Text ${i + 1}`,
        enabled: lane.enabled !== false,
        // Timelines saved against the old chain index carry one instead of
        // these two: index 0 was "under every effect", anything else was some
        // position the next mosh would have invalidated anyway.
        underEffects: lane.underEffects ?? legacyChainIndex(lane) === 0,
        z: typeof lane.z === "number" ? lane.z : TEXT_Z_BASE + i,
        style: { ...DEFAULT_TEXT_STYLE, ...(lane.style ?? legacyStyle) },
        effects: hydrateEffects(lane.effects),
        clips: clips.map((clip) => ({
          id: clip.id ?? nextId("clip"),
          start: clip.start ?? 0,
          end: clip.end ?? 0,
          text: clip.text ?? "",
        })),
      };
    }),
  };
}
