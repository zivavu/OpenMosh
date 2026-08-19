import { drawOverlayText, overlayTextSignature } from "../text-overlay";
import type { TextStyle } from "./types";

/**
 * Draw a text clip onto a 2D canvas with a transparent background. The canvas
 * becomes the text layer's source texture, so opacity and blend mode are
 * deliberately *not* applied here — the GL composite owns those.
 */
export function drawTextToCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  text: string,
  style: TextStyle,
): void {
  drawOverlayText(canvas, width, height, text, style);
}

/** Everything drawTextToCanvas would put on screen — see overlayTextSignature. */
export function textSignature(
  text: string,
  style: TextStyle,
  width: number,
  height: number,
  fontsVersion: number,
): string {
  return overlayTextSignature(text, style, width, height, fontsVersion);
}
