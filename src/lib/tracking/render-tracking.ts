import type { TrackingFrame, TrackingParams } from "./types";

/**
 * Draw the tracking HUD (FLIR-style corner brackets + minimal telemetry) onto
 * a 2D canvas with a transparent background. The canvas is later uploaded as
 * a texture and alpha-composited over the frame. Coordinates are top-down,
 * matching the normalized centers produced by the tracker.
 */
export function drawTrackingToCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  frame: TrackingFrame,
  params: TrackingParams,
  time: number,
): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const fg = params.color === "white" ? "#ffffff" : "#000000";
  const lw = Math.max(1, params.thickness * (height / 720));
  const fontSize = Math.max(9, Math.round(height * 0.016));
  ctx.lineWidth = lw;
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.font = font(fontSize);
  ctx.textBaseline = "alphabetic";

  for (const box of frame.boxes) {
    if (box.alpha <= 0) continue;

    // Reacquire: brackets sweep in from oversized to fitted.
    let scale = 1;
    if (box.state === "reacquire") {
      const t = Math.min(1, box.stateAge / 0.45);
      scale = 1 + (1 - t) * 1.2;
    }
    const bw = box.w * width * scale;
    const bh = box.h * height * scale;
    const x = box.cx * width - bw / 2;
    const y = box.cy * height - bh / 2;

    const lost = box.state === "lost";
    // Degraded brackets flicker occasionally; lost brackets dim + dash.
    let alpha = box.alpha;
    if (lost) alpha *= 0.55;
    else if (box.state === "degraded" && !blinkOn(time + box.cx * 7, 4)) {
      alpha *= 0.6;
    }

    ctx.globalAlpha = alpha;
    ctx.setLineDash(lost ? [lw * 3, lw * 3] : []);
    drawBrackets(ctx, x, y, bw, bh, box.primary ? 0.32 : 0.26);
    ctx.setLineDash([]);

    if (box.primary) {
      // Center designator dot.
      ctx.beginPath();
      ctx.arc(box.cx * width, box.cy * height, lw * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Labels: primary gets status + coords; lost boxes blink SIGNAL LOST;
    // other secondaries show only a tiny hex id.
    const labelAlpha = lost ? (blinkOn(time, 1.5) ? alpha * 1.6 : 0) : alpha;
    if (box.label && labelAlpha > 0) {
      const size = box.primary || lost ? fontSize : fontSize * 0.85;
      ctx.font = font(size);
      ctx.globalAlpha = Math.min(1, labelAlpha);
      ctx.fillText(box.label, x, y - size * 0.5);
    }
    if (box.sub) {
      ctx.font = font(fontSize * 0.85);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillText(box.sub, x, y + bh + fontSize * 1.1);
    }
    ctx.font = font(fontSize);
  }

  // Fixed center crosshair: belongs to the "camera", so it stays rock still
  // even during signal loss.
  const ch = Math.min(width, height) * 0.016;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(width / 2 - ch, height / 2);
  ctx.lineTo(width / 2 + ch, height / 2);
  ctx.moveTo(width / 2, height / 2 - ch);
  ctx.lineTo(width / 2, height / 2 + ch);
  ctx.stroke();

  ctx.globalAlpha = 1;
}

/**
 * Cheap signature of everything drawTrackingToCanvas would put on screen,
 * quantized to 0.1 px. When consecutive frames produce the same signature the
 * caller can skip the full-res canvas redraw and GPU texture upload entirely
 * (e.g. locked boxes that have settled on a still image). Must mirror the
 * drawing logic above: anything that changes the drawn pixels has to feed in.
 */
export function trackingFrameSignature(
  frame: TrackingFrame,
  params: TrackingParams,
  time: number,
  width: number,
  height: number,
): string {
  let s = `${width}x${height}|${params.color}|${params.thickness}|${frame.boxes.length}`;
  for (const box of frame.boxes) {
    if (box.alpha <= 0) continue;
    let scale = 1;
    if (box.state === "reacquire") {
      const t = Math.min(1, box.stateAge / 0.45);
      scale = 1 + (1 - t) * 1.2;
    }
    const blink =
      box.state === "degraded"
        ? blinkOn(time + box.cx * 7, 4)
        : box.state === "lost"
          ? blinkOn(time, 1.5)
          : false;
    s +=
      `;${box.state},${Math.round(box.cx * width * 10)},${Math.round(box.cy * height * 10)}` +
      `,${Math.round(box.w * width * scale * 10)},${Math.round(box.h * height * scale * 10)}` +
      `,${Math.round(box.alpha * 128)},${blink ? 1 : 0},${box.primary ? 1 : 0},${box.label},${box.sub}`;
  }
  return s;
}

function font(px: number): string {
  return `${px}px ui-monospace, "SF Mono", Menlo, monospace`;
}

/** Square-wave blink: on/off at `hz` cycles per second. */
function blinkOn(time: number, hz: number): boolean {
  return Math.floor(time * hz * 2) % 2 === 0;
}

/** Four L-shaped corner brackets; `arm` is arm length as a fraction of the side. */
function drawBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arm: number,
): void {
  const ax = w * arm;
  const ay = h * arm;
  ctx.beginPath();
  // top-left
  ctx.moveTo(x, y + ay);
  ctx.lineTo(x, y);
  ctx.lineTo(x + ax, y);
  // top-right
  ctx.moveTo(x + w - ax, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + ay);
  // bottom-right
  ctx.moveTo(x + w, y + h - ay);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - ax, y + h);
  // bottom-left
  ctx.moveTo(x + ax, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - ay);
  ctx.stroke();
}
