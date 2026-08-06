import type { TextOverlayBlendMode } from "../text-overlay";

/** The defId this overlay effect is registered under in EFFECT_DEFINITIONS. */
export const CAPTION_EFFECT_ID = "caption";

export type CaptionAlign = "left" | "center" | "right";

export interface CaptionParams {
  text: string;
  /** Anchor position, normalized (x: left→right, y: top→bottom). */
  x: number;
  y: number;
  /** Font size as a fraction of frame height. */
  size: number;
  /** CSS font-family value (see text-overlay/fonts.ts). */
  fontFamily: string;
  align: CaptionAlign;
  color: string;
  outline: boolean;
  outlineColor: string;
  /** Stroke width, in px at a 720px reference height (scaled to actual size). */
  outlineWidth: number;
  /** 0..1, applied by the GL composite rather than the 2D canvas. */
  opacity: number;
  blendMode: TextOverlayBlendMode;
}

const BLEND_MODES: TextOverlayBlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "add",
  "subtract",
  "difference",
  "exclusion",
];

export function readCaptionParams(
  values: Record<string, number | string>,
): CaptionParams {
  const align = String(values.align ?? "center");
  const blendMode = String(values.blendMode ?? "normal");
  return {
    text: String(values.text ?? ""),
    x: Number(values.x ?? 0.5),
    y: Number(values.y ?? 0.5),
    size: Number(values.size ?? 0.1),
    fontFamily: String(values.font ?? "Georgia, serif"),
    align: (align === "left" || align === "right"
      ? align
      : "center") as CaptionAlign,
    color: String(values.color ?? "#ffffff"),
    outline: Number(values.outline ?? 1) === 1,
    outlineColor: String(values.outlineColor ?? "#000000"),
    outlineWidth: Number(values.outlineWidth ?? 2),
    opacity: Number(values.opacity ?? 1),
    blendMode: (BLEND_MODES.includes(blendMode as TextOverlayBlendMode)
      ? blendMode
      : "normal") as TextOverlayBlendMode,
  };
}
