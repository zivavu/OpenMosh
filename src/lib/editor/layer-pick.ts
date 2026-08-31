// Straight from the module, not the barrel: that re-exports the custom-font
// store, whose runes can't run outside a Svelte build.
import { overlayTextBox } from "../text-overlay/draw";
import type { ResolvedMediaLayer } from "../media";
import type { ResolvedTextLayer } from "../text";

/**
 * Picking a layer by clicking the preview. The box is where the layer's
 * placement puts it, before its own effects move any of those pixels — the
 * same thing the selection outline draws, and wrong in the same way for a
 * chain that displaces the media. Rectangles, not coverage: a keyed or cropped
 * layer is clickable across its whole box.
 */
export interface LayerHitBox {
  kind: "media" | "text";
  laneId: string;
  /** Composited ahead of the main chain, so always beneath the layers that
   * aren't — the one ordering `z` alone doesn't say. */
  underEffects: boolean;
  z: number;
  /** Centre, size and rotation in output pixels. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

/**
 * What a click on the preview landed on: a layer, or the image every layer
 * sits over. "base" carries no id — what that image belongs to is the editor's
 * question, and it answers differently per mode.
 */
export type LayerPick =
  | { kind: "media" | "text"; laneId: string }
  | { kind: "base" };

/** Where a media lane's placement lands, in output pixels. */
export interface MediaRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

export function pointInLayer(box: LayerHitBox, px: number, py: number): boolean {
  if (box.w <= 0 || box.h <= 0) return false;
  const dx = px - box.cx;
  const dy = py - box.cy;
  // Into the box's own frame, so a rotated layer is hit where it looks like it
  // is rather than across the axis-aligned span it covers.
  const cos = Math.cos(-box.rot);
  const sin = Math.sin(-box.rot);
  return (
    Math.abs(dx * cos - dy * sin) <= box.w / 2 &&
    Math.abs(dx * sin + dy * cos) <= box.h / 2
  );
}

/**
 * The layer a click at `px`, `py` lands on: the one drawn last of those it
 * hits, so what the user points at is what they were looking at. Null when the
 * click misses every layer.
 */
export function pickTopLayer(
  boxes: LayerHitBox[],
  px: number,
  py: number,
): LayerHitBox | null {
  let top: LayerHitBox | null = null;
  for (const box of boxes) {
    if (!pointInLayer(box, px, py)) continue;
    if (!top || drawnAfter(box, top)) top = box;
  }
  return top;
}

/** Composite order between two layers: over the chain beats under it, then z,
 * and ties go to whichever the caller listed later. */
function drawnAfter(box: LayerHitBox, other: LayerHitBox): boolean {
  if (box.underEffects !== other.underEffects) return !box.underEffects;
  return box.z >= other.z;
}

/**
 * Boxes for everything on screen this frame. `mediaRect` is the renderer's
 * own placement — it knows the natural size the fit is measured against, which
 * the lane's style alone doesn't say, and returns null for a lane whose first
 * frame hasn't arrived.
 */
export function layerHitBoxes(
  media: ResolvedMediaLayer[],
  text: ResolvedTextLayer[],
  frameW: number,
  frameH: number,
  mediaRect: (layer: ResolvedMediaLayer) => MediaRect | null,
): LayerHitBox[] {
  const boxes: LayerHitBox[] = [];
  for (const layer of media) {
    const rect = mediaRect(layer);
    if (!rect) continue;
    boxes.push({
      kind: "media",
      laneId: layer.laneId,
      underEffects: layer.underEffects,
      z: layer.z,
      cx: rect.x + rect.w / 2,
      cy: rect.y + rect.h / 2,
      w: rect.w,
      h: rect.h,
      rot: rect.rot,
    });
  }
  for (const layer of text) {
    const box = overlayTextBox(frameW, frameH, layer.text, layer.style);
    if (!box) continue;
    boxes.push({
      kind: "text",
      laneId: layer.laneId,
      underEffects: layer.underEffects,
      z: layer.z,
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
      w: box.w,
      h: box.h,
      rot: 0,
    });
  }
  return boxes;
}
