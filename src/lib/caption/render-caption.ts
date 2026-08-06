import type { CaptionParams } from "./types";

/** Wrap width, as a fraction of frame width, before a caption breaks lines. */
const MAX_WIDTH_RATIO = 0.92;
const LINE_HEIGHT = 1.2;

/**
 * Draw a caption onto a 2D canvas with a transparent background. The canvas is
 * uploaded as a texture and blended over the chain by the renderer, so opacity
 * and blend mode are deliberately *not* applied here.
 */
export function drawCaptionToCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  params: CaptionParams,
): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  if (!params.text.trim()) return;

  const fontSize = Math.max(4, Math.round(height * params.size));
  ctx.font = `${fontSize}px ${params.fontFamily}`;
  // Align names the side of Position X the text sits on, so "left" puts the
  // text left of the anchor — the inverse of the canvas' edge-naming.
  ctx.textAlign =
    params.align === "left"
      ? "right"
      : params.align === "right"
        ? "left"
        : "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  const lines = wrapLines(ctx, params.text, width * MAX_WIDTH_RATIO);
  const lineHeight = fontSize * LINE_HEIGHT;
  const x = width * params.x;
  let y = height * params.y - ((lines.length - 1) * lineHeight) / 2;

  const strokeWidth = params.outlineWidth * (height / 720);
  for (const line of lines) {
    if (params.outline && strokeWidth > 0) {
      ctx.strokeStyle = params.outlineColor;
      ctx.lineWidth = strokeWidth * 2; // half the stroke sits under the fill
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = params.color;
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
}

/**
 * Everything drawCaptionToCanvas would put on screen. When two frames share a
 * signature the caller can skip the redraw and the GPU upload entirely.
 * `fontsVersion` covers webfaces that finish loading after a first draw.
 */
export function captionSignature(
  params: CaptionParams,
  width: number,
  height: number,
  fontsVersion: number,
): string {
  return [
    width,
    height,
    fontsVersion,
    params.text,
    Math.round(params.x * width),
    Math.round(params.y * height),
    Math.round(params.size * height),
    params.fontFamily,
    params.align,
    params.color,
    params.outline ? params.outlineColor : "",
    params.outline ? params.outlineWidth : 0,
  ].join("|");
}

/** Break on explicit newlines first, then wrap each part to `maxWidth`. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const part of text.split("\n")) {
    const words = part.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}
