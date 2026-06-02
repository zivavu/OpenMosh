import type { TrackingFrame, TrackingParams } from "./types";

/**
 * Draw the tracking HUD (boxes, labels, connecting lines) onto a 2D canvas with
 * a transparent background. The canvas is later uploaded as a texture and
 * alpha-composited over the frame. Coordinates are top-down, matching the
 * normalized centers produced by the tracker.
 */
export function drawTrackingToCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  frame: TrackingFrame,
  params: TrackingParams,
): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const fg = params.color === "white" ? "#ffffff" : "#000000";
  const bg = params.color === "white" ? "#000000" : "#ffffff";
  const lw = Math.max(1, params.thickness * (height / 720));
  const fontSize = Math.max(9, Math.round(height * 0.016));
  const dot = Math.max(1.5, lw * 1.4);

  ctx.lineWidth = lw;
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.font = `${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textBaseline = "alphabetic";

  const cxPx = (i: number) => frame.boxes[i].cx * width;
  const cyPx = (i: number) => frame.boxes[i].cy * height;

  // Lines first, under the boxes.
  for (const [a, b] of frame.lines) {
    const alpha = Math.min(frame.boxes[a].alpha, frame.boxes[b].alpha);
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha * 0.7;
    ctx.beginPath();
    ctx.moveTo(cxPx(a), cyPx(a));
    ctx.lineTo(cxPx(b), cyPx(b));
    ctx.stroke();
    for (const i of [a, b]) {
      ctx.beginPath();
      ctx.arc(cxPx(i), cyPx(i), dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const box of frame.boxes) {
    if (box.alpha <= 0) continue;
    const bw = box.w * width;
    const bh = box.h * height;
    const x = box.cx * width - bw / 2;
    const y = box.cy * height - bh / 2;

    // Offset "glitch shadow" duplicate, then the solid box.
    ctx.globalAlpha = box.alpha * 0.3;
    ctx.strokeRect(x + lw * 1.5, y + lw * 1.5, bw, bh);
    ctx.globalAlpha = box.alpha;
    ctx.strokeRect(x, y, bw, bh);

    // Labels: primary above the box, secondary below.
    drawLabel(ctx, box.label, x, y - fontSize * 0.5, fg, bg, box.alpha, fontSize);
    drawLabel(
      ctx,
      box.sub,
      x,
      y + bh + fontSize * 1.2,
      fg,
      bg,
      box.alpha,
      fontSize,
    );
  }

  ctx.globalAlpha = 1;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  fg: string,
  bg: string,
  alpha: number,
  fontSize: number,
): void {
  if (!text) return;
  const w = ctx.measureText(text).width;
  const padX = 3;
  const padY = 2;
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = bg;
  ctx.fillRect(
    x - padX,
    baseline - fontSize + padY * 0.5,
    w + padX * 2,
    fontSize + padY,
  );
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fg;
  ctx.fillText(text, x, baseline);
}
