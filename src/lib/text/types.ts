import type { EffectInstance } from "../effects/types";
import { FONT_OPTIONS, type TextOverlayBlendMode } from "../text-overlay";

export type TextAlign = "left" | "center" | "right";

/** Shortest clip the timeline will create or leave behind after a resize. */
export const MIN_CLIP_LENGTH = 0.05;

/** How a clip's text is drawn, independent of when it is on screen. */
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

/** One span of text on a lane, with its own effect chain. */
export interface TextClip {
  id: string;
  /** Seconds on the mode's master timeline. */
  start: number;
  end: number;
  text: string;
  style: TextStyle;
  /** Applied to this clip's text layer alone, before it meets the image. */
  effects: EffectInstance[];
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

export function createTextClip(
  start: number,
  end: number,
  text = "",
  style?: Partial<TextStyle>,
): TextClip {
  return {
    id: nextId("clip"),
    start,
    end,
    text,
    style: { ...DEFAULT_TEXT_STYLE, ...style },
    effects: [],
  };
}

export function createTextLane(
  name: string,
  chainIndex = Number.MAX_SAFE_INTEGER,
): TextLane {
  return { id: nextId("lane"), name, enabled: true, chainIndex, clips: [] };
}

export function createTextTimeline(): TextTimeline {
  return { enabled: true, lanes: [createTextLane("Text 1")] };
}

/** Fill in anything a saved timeline predates or dropped. */
export function normalizeTextTimeline(raw: unknown): TextTimeline {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TEXT_TIMELINE };
  const t = raw as Partial<TextTimeline>;
  const lanes = Array.isArray(t.lanes) ? t.lanes : [];
  return {
    enabled: !!t.enabled,
    lanes: lanes.map((lane, i) => ({
      id: lane.id ?? nextId("lane"),
      name: lane.name ?? `Text ${i + 1}`,
      enabled: lane.enabled !== false,
      chainIndex:
        typeof lane.chainIndex === "number"
          ? lane.chainIndex
          : Number.MAX_SAFE_INTEGER,
      clips: (Array.isArray(lane.clips) ? lane.clips : []).map((clip) => ({
        id: clip.id ?? nextId("clip"),
        start: clip.start ?? 0,
        end: clip.end ?? 0,
        text: clip.text ?? "",
        style: { ...DEFAULT_TEXT_STYLE, ...clip.style },
        effects: Array.isArray(clip.effects) ? clip.effects : [],
      })),
    })),
  };
}
