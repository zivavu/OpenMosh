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

/**
 * Where the wrapped lines land, with the context already set up to draw them.
 * Both the draw and the box measurement come through here, so what the preview
 * calls clickable can't drift from what the glyphs cover.
 */
interface TextLayout {
  lines: string[];
  lineHeight: number;
  /** The anchor every line is drawn at; `align` decides which side it sits on. */
  x: number;
  /** Centre of the first line — the context draws on a "middle" baseline. */
  firstY: number;
  align: CanvasTextAlign;
  /** How far the outline reaches past the glyphs. 0 when there is none. */
  strokeWidth: number;
}

/** Set `ctx` up for this style and work out where its lines go. */
function layoutText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  style: CanvasTextStyle,
): TextLayout | null {
  const fontSize = Math.max(4, Math.round(height * style.size));
  ctx.font = `${fontSize}px ${style.fontFamily}`;
  const lines = wrapLines(ctx, text, width * MAX_WIDTH_RATIO);
  if (lines.length === 0) return null;
  const lineHeight = fontSize * LINE_HEIGHT;
  return {
    lines,
    lineHeight,
    x: width * style.x,
    firstY: height * style.y - ((lines.length - 1) * lineHeight) / 2,
    // Align names the side of Position X the text sits on, so "left" puts the
    // text left of the anchor — the inverse of the canvas' edge-naming.
    align:
      style.align === "left" ? "right" : style.align === "right" ? "left" : "center",
    strokeWidth: style.outline ? style.outlineWidth * (height / 720) : 0,
  };
}

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

  const layout = layoutText(ctx, width, height, text, style);
  if (!layout) return;
  ctx.textAlign = layout.align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  let y = layout.firstY;
  for (const line of layout.lines) {
    if (layout.strokeWidth > 0) {
      ctx.strokeStyle = style.outlineColor;
      ctx.lineWidth = layout.strokeWidth * 2; // half the stroke sits under the fill
      ctx.strokeText(line, layout.x, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, layout.x, y);
    y += layout.lineHeight;
  }
}

/** Where drawn text lands, in canvas pixels. */
export interface OverlayTextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Measuring canvas: a text lane has no texture to ask, and the one the
 * renderer draws into is mid-frame whenever a click arrives. */
let scratch: CanvasRenderingContext2D | null | undefined;
function scratchContext(): CanvasRenderingContext2D | null {
  if (scratch === undefined) {
    scratch =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }
  return scratch;
}

/**
 * The box drawn text occupies, for picking a text layer by clicking the
 * preview. Line boxes rather than glyph ink: the height is the wrapped lines'
 * leading, so a lane stays clickable in the gaps its descenders leave.
 *
 * Null when there is nothing on screen to hit.
 */
export function overlayTextBox(
  width: number,
  height: number,
  text: string,
  style: CanvasTextStyle,
): OverlayTextBox | null {
  if (width <= 0 || height <= 0 || !text.trim()) return null;
  const ctx = scratchContext();
  if (!ctx) return null;
  const layout = layoutText(ctx, width, height, text, style);
  if (!layout) return null;
  let widest = 0;
  for (const line of layout.lines) {
    widest = Math.max(widest, ctx.measureText(line).width);
  }
  const left =
    layout.align === "right"
      ? layout.x - widest
      : layout.align === "left"
        ? layout.x
        : layout.x - widest / 2;
  return {
    x: left - layout.strokeWidth,
    y: layout.firstY - layout.lineHeight / 2 - layout.strokeWidth,
    w: widest + layout.strokeWidth * 2,
    h: layout.lines.length * layout.lineHeight + layout.strokeWidth * 2,
  };
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
