import type { EffectInstance } from "../effects/types";
import { FONT_OPTIONS, type TextOverlayBlendMode } from "../text-overlay";

export type TextAlign = "left" | "center" | "right";

/** Shortest clip the timeline will create or leave behind after a resize. */
export const MIN_CLIP_LENGTH = 0.05;

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
export interface TextClip {
  id: string;
  /** Seconds on the mode's master timeline. */
  start: number;
  end: number;
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
   * Where this layer meets the main effect chain, as an index into the enabled
   * main effects. 0 composites the text before every image effect, so they all
   * distort it; a value at or past the end lays it over the finished frame.
   */
  chainIndex: number;
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

export function createTextLane(
  name: string,
  chainIndex = Number.MAX_SAFE_INTEGER,
  style: TextStyle = DEFAULT_TEXT_STYLE,
): TextLane {
  return {
    id: nextId("lane"),
    name,
    enabled: true,
    chainIndex,
    style: { ...style },
    effects: [],
    clips: [],
  };
}

export function createTextTimeline(): TextTimeline {
  return { enabled: true, lanes: [createTextLane("Text 1")] };
}

/** Add an empty lane, named after its position. */
export function appendTextLane(timeline: TextTimeline): TextTimeline {
  return {
    ...timeline,
    lanes: [...timeline.lanes, createTextLane(`Text ${timeline.lanes.length + 1}`)],
  };
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
        chainIndex:
          typeof lane.chainIndex === "number"
            ? lane.chainIndex
            : Number.MAX_SAFE_INTEGER,
        style: { ...DEFAULT_TEXT_STYLE, ...(lane.style ?? legacyStyle) },
        effects: Array.isArray(lane.effects) ? lane.effects : [],
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
