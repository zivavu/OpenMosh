/**
 * Drawing text onto a 2D canvas, shared by the text-timeline lanes and the
 * caption effect. Both produce a transparent canvas that the renderer uploads
 * and blends over the chain, so the two have to agree pixel for pixel — they
 * used to hold a copy each, which is a standing invitation to drift.
 */

/** The part of a text style that actually reaches the canvas. Opacity and blend
 * mode are deliberately absent: the GL composite owns those. */
export interface CanvasTextStyle {
  /** Anchor position, normalized (x: left→right, y: top→bottom). */
  x: number;
  y: number;
  /** Font size as a fraction of frame height. */
  size: number;
  /** CSS font-family value (see fonts.ts). */
  fontFamily: string;
  /** Which side of the anchor the text sits on. */
  align: "left" | "center" | "right";
  color: string;
  outline: boolean;
  outlineColor: string;
  /** Stroke width, in px at a 720px reference height (scaled to actual size). */
  outlineWidth: number;
}

/** Wrap width, as a fraction of frame width, before a line breaks. */
const MAX_WIDTH_RATIO = 0.92;
const LINE_HEIGHT = 1.2;

/** Draw `text` onto `canvas` over a transparent background. */
export function drawOverlayText(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  text: string,
  style: CanvasTextStyle,
): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  if (!text.trim()) return;

  const fontSize = Math.max(4, Math.round(height * style.size));
  ctx.font = `${fontSize}px ${style.fontFamily}`;
  // Align names the side of Position X the text sits on, so "left" puts the
  // text left of the anchor — the inverse of the canvas' edge-naming.
  ctx.textAlign =
    style.align === "left" ? "right" : style.align === "right" ? "left" : "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  const lines = wrapLines(ctx, text, width * MAX_WIDTH_RATIO);
  const lineHeight = fontSize * LINE_HEIGHT;
  const x = width * style.x;
  let y = height * style.y - ((lines.length - 1) * lineHeight) / 2;

  const strokeWidth = style.outlineWidth * (height / 720);
  for (const line of lines) {
    if (style.outline && strokeWidth > 0) {
      ctx.strokeStyle = style.outlineColor;
      ctx.lineWidth = strokeWidth * 2; // half the stroke sits under the fill
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
}

/**
 * Everything drawOverlayText would put on screen. When two frames share a
 * signature the caller can skip the redraw and the GPU upload entirely.
 * `fontsVersion` covers webfaces that finish loading after a first draw.
 */
export function overlayTextSignature(
  text: string,
  style: CanvasTextStyle,
  width: number,
  height: number,
  fontsVersion: number,
): string {
  return [
    width,
    height,
    fontsVersion,
    text,
    Math.round(style.x * width),
    Math.round(style.y * height),
    Math.round(style.size * height),
    style.fontFamily,
    style.align,
    style.color,
    style.outline ? style.outlineColor : "",
    style.outline ? style.outlineWidth : 0,
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
