import { hexToRgb } from "../color";
import type { FrameBox, TrackingFrame, TrackingParams } from "./types";

interface BoxGeom {
	box: FrameBox;
	cx: number;
	cy: number;
	x: number;
	y: number;
	bw: number;
	bh: number;
	alpha: number;
}

/** Draw the tracking HUD (precision optical brackets/frames/reticles, telemetry
 * links, and scalable monospace typography) onto a 2D canvas with a transparent
 * background, later uploaded as a texture and alpha-composited over the frame.
 * Coordinates are top-down, matching the normalized centers the tracker produces. */
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

	const minDim = Math.min(width, height);
	const scaleRef = minDim / 720;
	const fg = params.color;
	const rgb = hexToRgb(fg) ?? { r: 255, g: 255, b: 255 };
	const inkLum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;

	const rawLw = params.thickness * scaleRef;
	const lines = params.thickness > 0;
	const lw = lines ? Math.max(1, rawLw) : 0;
	// Sub-pixel line widths fade gracefully instead of vanishing into murky grey.
	const strokeFade = lines ? Math.min(1, Math.max(0.35, rawLw)) : 0;

	ctx.lineCap = "butt";
	ctx.lineJoin = "miter";
	ctx.strokeStyle = fg;
	ctx.fillStyle = fg;
	ctx.textBaseline = "alphabetic";

	// Subtle tight contrast halo so crisp white ink stays legible over bright skies
	// and black ink stays legible over dark footage, without looking glowy.
	ctx.shadowColor =
		inkLum >= 0.42 ? "rgba(0, 0, 0, 0.72)" : "rgba(255, 255, 255, 0.54)";
	ctx.shadowBlur = Math.max(2.5, lw * 1.8);
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 0;

	// Compute aspect-correct screen geometry once for both links and target frames.
	const geoms: BoxGeom[] = [];
	for (const box of frame.boxes) {
		if (box.alpha <= 0) continue;
		const scale = boxScale(box);
		const bw = Math.max(6 * scaleRef, box.w * minDim * scale);
		const bh = Math.max(6 * scaleRef, box.h * minDim * scale);
		const cx = box.cx * width;
		const cy = box.cy * height;
		const lost = box.state === "lost";
		let alpha = box.alpha;
		if (lost) alpha *= 0.72;
		else if (box.state === "degraded" && !blinkOn(time + box.cx * 7, 4)) {
			alpha *= 0.72;
		}
		geoms.push({
			box,
			cx,
			cy,
			x: cx - bw / 2,
			y: cy - bh / 2,
			bw,
			bh,
			alpha,
		});
	}

	// 1. Sleek constellation telemetry links trimmed cleanly to box perimeters.
	if (lines && params.links > 0 && geoms.length >= 2) {
		drawTelemetryLinks(
			ctx,
			geoms,
			width,
			height,
			minDim,
			scaleRef,
			lw,
			strokeFade,
			params.links,
		);
	}

	// 2. Target frames / brackets / reticles and scalable typography.
	const baseFont =
		params.textSize > 0 ? params.textSize * Math.max(scaleRef, 0.52) : 0;
	const showText = baseFont >= 1;

	for (const g of geoms) {
		const { box, cx, cy, x, y, bw, bh, alpha } = g;
		const lost = box.state === "lost";

		if (lines) {
			ctx.globalAlpha = alpha * strokeFade;
			ctx.lineWidth = lw;
			ctx.setLineDash(lost ? [lw * 3, lw * 2.5] : []);

			if (params.hudStyle === "box") {
				drawFrameStyle(
					ctx,
					x,
					y,
					bw,
					bh,
					cx,
					cy,
					lw,
					scaleRef,
					box.primary,
					lost,
					alpha * strokeFade,
				);
			} else if (params.hudStyle === "reticle") {
				drawReticleStyle(
					ctx,
					x,
					y,
					bw,
					bh,
					cx,
					cy,
					lw,
					scaleRef,
					box.primary,
					lost,
					alpha * strokeFade,
				);
			} else {
				drawBracketsStyle(
					ctx,
					x,
					y,
					bw,
					bh,
					cx,
					cy,
					lw,
					scaleRef,
					box.primary,
					lost,
					alpha * strokeFade,
				);
			}
			ctx.setLineDash([]);
		}

		if (showText) {
			const labelAlpha = lost
				? blinkOn(time, 1.5)
					? Math.min(1, alpha * 1.35)
					: 0
				: alpha;
			drawBoxLabels(
				ctx,
				g,
				width,
				height,
				baseFont,
				labelAlpha,
				params.labels,
				params.hudStyle,
				scaleRef,
			);
		}
	}

	// 3. Open-center optical camera crosshair (stays rock-still even during loss).
	if (lines && params.crosshair) {
		const outer = minDim * 0.021;
		const gap = minDim * 0.007;
		const mx = width * 0.5;
		const my = height * 0.5;
		ctx.lineWidth = Math.max(1, lw * 0.78);
		ctx.globalAlpha = 0.78 * strokeFade;
		ctx.beginPath();
		ctx.moveTo(mx - outer, my);
		ctx.lineTo(mx - gap, my);
		ctx.moveTo(mx + gap, my);
		ctx.lineTo(mx + outer, my);
		ctx.moveTo(mx, my - outer);
		ctx.lineTo(mx, my - gap);
		ctx.moveTo(mx, my + gap);
		ctx.lineTo(mx, my + outer);
		ctx.stroke();

		ctx.globalAlpha = 0.6 * strokeFade;
		ctx.beginPath();
		ctx.arc(mx, my, Math.max(0.9, lw * 0.45), 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.globalAlpha = 1;
}

/** Cheap signature of everything drawTrackingToCanvas would put on screen,
 * quantized to 0.1 px. When consecutive frames produce the same signature the
 * caller can skip the canvas redraw and GPU upload (e.g. locked boxes settled
 * on a still image). Must mirror the drawing logic above: anything that changes
 * the drawn pixels has to feed in. */
export function trackingFrameSignature(
	frame: TrackingFrame,
	params: TrackingParams,
	time: number,
	width: number,
	height: number,
): string {
	const minDim = Math.min(width, height);
	let s =
		`${width}x${height}|${params.color}|${params.thickness}|${params.hudStyle}` +
		`|${params.textSize}|${params.labels}|${params.links.toFixed(3)}` +
		`|${params.crosshair ? 1 : 0}|${frame.boxes.length}`;
	for (const box of frame.boxes) {
		if (box.alpha <= 0) continue;
		const scale = boxScale(box);
		const blink =
			box.state === "degraded"
				? blinkOn(time + box.cx * 7, 4)
				: box.state === "lost"
					? blinkOn(time, 1.5)
					: false;
		s +=
			`;${box.key},${box.state},${Math.round(box.cx * width * 10)},${Math.round(box.cy * height * 10)}` +
			`,${Math.round(box.w * minDim * scale * 10)},${Math.round(box.h * minDim * scale * 10)}` +
			`,${Math.round(box.alpha * 128)},${blink ? 1 : 0},${box.primary ? 1 : 0},${box.label},${box.sub}`;
	}
	return s;
}

function boxScale(box: FrameBox): number {
	if (box.state === "reacquire") {
		const u = Math.min(1, box.stateAge / 0.4);
		const ease = 1 - (1 - u) ** 3;
		return 1 + (1 - ease) * 0.85;
	}
	if (box.age < 0.16) {
		const u = Math.max(0, box.age / 0.16);
		const ease = 1 - (1 - u) ** 3;
		return 1 + (1 - ease) * 0.24;
	}
	return 1;
}

function font(px: number, weight = 500): string {
	return `${weight} ${px}px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace`;
}

/** Square-wave blink: on/off at `hz` cycles per second. */
function blinkOn(time: number, hz: number): boolean {
	return Math.floor(time * hz * 2) % 2 === 0;
}

/** Style 1 ("brackets"): Precision architectural corner L-brackets with primary
 * edge ticks and an open optical center sight. */
function drawBracketsStyle(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	cx: number,
	cy: number,
	lw: number,
	scaleRef: number,
	primary: boolean,
	lost: boolean,
	baseAlpha: number,
): void {
	const side = Math.min(w, h);
	const arm = Math.max(
		5 * scaleRef,
		Math.min(28 * scaleRef, side * (primary ? 0.29 : 0.24)),
	);
	drawBrackets(
		ctx,
		x,
		y,
		w,
		h,
		Math.min(arm, w * 0.44),
		Math.min(arm, h * 0.44),
	);

	if (lost) {
		const lostR = Math.max(4 * scaleRef, Math.min(12 * scaleRef, side * 0.12));
		ctx.setLineDash([lw * 2, lw * 2]);
		ctx.globalAlpha = baseAlpha * 0.72;
		drawOpenCross(ctx, cx, cy, lostR * 0.35, lostR);
		ctx.setLineDash([]);
		return;
	}
	if (primary) {
		// Delicate inward midpoint ticks on the four sides.
		const tick = Math.max(
			2.5 * scaleRef,
			Math.min(6.5 * scaleRef, side * 0.065),
		);
		ctx.lineWidth = Math.max(1, lw * 0.75);
		ctx.globalAlpha = baseAlpha * 0.78;
		ctx.beginPath();
		ctx.moveTo(cx, y);
		ctx.lineTo(cx, y + tick);
		ctx.moveTo(cx, y + h);
		ctx.lineTo(cx, y + h - tick);
		ctx.moveTo(x, cy);
		ctx.lineTo(x + tick, cy);
		ctx.moveTo(x + w, cy);
		ctx.lineTo(x + w - tick, cy);
		ctx.stroke();

		// Open optical center sight instead of a heavy filled dot.
		const outer = Math.max(
			4.5 * scaleRef,
			Math.min(11 * scaleRef, side * 0.12),
		);
		const gap = outer * 0.38;
		ctx.globalAlpha = baseAlpha * 0.9;
		drawOpenCross(ctx, cx, cy, gap, outer);
	} else {
		// Restrained micro center pip on secondary targets.
		const p = Math.max(2 * scaleRef, Math.min(4 * scaleRef, side * 0.045));
		ctx.lineWidth = Math.max(1, lw * 0.65);
		ctx.globalAlpha = baseAlpha * 0.55;
		ctx.beginPath();
		ctx.moveTo(cx - p, cy);
		ctx.lineTo(cx + p, cy);
		ctx.moveTo(cx, cy - p);
		ctx.lineTo(cx, cy + p);
		ctx.stroke();
	}
}

/** Style 2 ("box"): Editorial hairline full frame with reinforced corner caps. */
function drawFrameStyle(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	cx: number,
	cy: number,
	lw: number,
	scaleRef: number,
	primary: boolean,
	lost: boolean,
	baseAlpha: number,
): void {
	// Crisp hairline perimeter.
	ctx.lineWidth = Math.max(1, lw * 0.6);
	ctx.globalAlpha = baseAlpha * (primary ? 0.55 : 0.38);
	ctx.strokeRect(x, y, w, h);

	// Reinforced full-opacity corner L-caps on top.
	const side = Math.min(w, h);
	const arm = Math.max(
		4 * scaleRef,
		Math.min(18 * scaleRef, side * (primary ? 0.22 : 0.17)),
	);
	ctx.lineWidth = Math.max(1, lw * 1.1);
	ctx.globalAlpha = baseAlpha;
	drawBrackets(
		ctx,
		x,
		y,
		w,
		h,
		Math.min(arm, w * 0.42),
		Math.min(arm, h * 0.42),
	);

	if (lost) return;
	ctx.setLineDash([]);
	if (primary) {
		const outer = Math.max(4 * scaleRef, Math.min(9.5 * scaleRef, side * 0.1));
		ctx.lineWidth = Math.max(1, lw * 0.72);
		ctx.globalAlpha = baseAlpha * 0.85;
		drawOpenCross(ctx, cx, cy, outer * 0.36, outer);
	}
}

/** Style 3 ("reticle"): Minimal kinetic corner cross-ticks + central optical sight. */
function drawReticleStyle(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	cx: number,
	cy: number,
	lw: number,
	scaleRef: number,
	primary: boolean,
	lost: boolean,
	baseAlpha: number,
): void {
	const side = Math.min(w, h);
	const t = Math.max(
		3.5 * scaleRef,
		Math.min(9.5 * scaleRef, side * (lost ? 0.1 : 0.085)),
	);
	ctx.setLineDash([]);
	ctx.lineWidth = Math.max(1, lw * (lost ? 0.95 : 0.85));
	ctx.globalAlpha = baseAlpha * (lost ? 0.8 : 0.9);
	ctx.beginPath();
	// Four crisp corner '+' fiducial ticks.
	for (const [px, py] of [
		[x, y],
		[x + w, y],
		[x + w, y + h],
		[x, y + h],
	]) {
		ctx.moveTo(px - t, py);
		ctx.lineTo(px + t, py);
		ctx.moveTo(px, py - t);
		ctx.lineTo(px, py + t);
	}
	ctx.stroke();

	if (lost) return;
	ctx.setLineDash([]);
	const outer = Math.max(
		6 * scaleRef,
		Math.min(22 * scaleRef, side * (primary ? 0.24 : 0.17)),
	);
	const gap = outer * 0.36;
	ctx.lineWidth = Math.max(1, lw * (primary ? 0.95 : 0.75));
	ctx.globalAlpha = baseAlpha;
	drawOpenCross(ctx, cx, cy, gap, outer);

	if (primary) {
		// Twin precision arc parentheses around the primary sight.
		const r = outer * 0.78;
		ctx.lineWidth = Math.max(1, lw * 0.7);
		ctx.globalAlpha = baseAlpha * 0.78;
		ctx.beginPath();
		ctx.arc(cx, cy, r, -Math.PI * 0.28, Math.PI * 0.28);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(cx, cy, r, Math.PI * 0.72, Math.PI * 1.28);
		ctx.stroke();
	}
}

/** Four L-shaped corner brackets with explicit pixel arm lengths. */
function drawBrackets(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	ax: number,
	ay: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x, y + ay);
	ctx.lineTo(x, y);
	ctx.lineTo(x + ax, y);
	ctx.moveTo(x + w - ax, y);
	ctx.lineTo(x + w, y);
	ctx.lineTo(x + w, y + ay);
	ctx.moveTo(x + w, y + h - ay);
	ctx.lineTo(x + w, y + h);
	ctx.lineTo(x + w - ax, y + h);
	ctx.moveTo(x + ax, y + h);
	ctx.lineTo(x, y + h);
	ctx.lineTo(x, y + h - ay);
	ctx.stroke();
}

function drawOpenCross(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	gap: number,
	outer: number,
): void {
	ctx.beginPath();
	ctx.moveTo(cx - outer, cy);
	ctx.lineTo(cx - gap, cy);
	ctx.moveTo(cx + gap, cy);
	ctx.lineTo(cx + outer, cy);
	ctx.moveTo(cx, cy - outer);
	ctx.lineTo(cx, cy - gap);
	ctx.moveTo(cx, cy + gap);
	ctx.lineTo(cx, cy + outer);
	ctx.stroke();
}

/** Draw clean constellation telemetry links connecting active targets, trimmed
 * cleanly to the outer edge of each box with subtle anchor pips. */
function drawTelemetryLinks(
	ctx: CanvasRenderingContext2D,
	geoms: BoxGeom[],
	width: number,
	height: number,
	minDim: number,
	scaleRef: number,
	lw: number,
	strokeFade: number,
	density: number,
): void {
	const active = geoms.filter((g) => g.box.state !== "lost" && g.alpha > 0.15);
	const n = active.length;
	if (n < 2) return;

	// Build a minimum spanning tree (Prim's) so the base constellation is coherent
	// and never a messy web of crossing lines.
	const inTree = new Uint8Array(n);
	inTree[0] = 1;
	const mst: { a: number; b: number; d: number }[] = [];
	const edgeKey = (i: number, j: number) => (i < j ? i * n + j : j * n + i);
	const used = new Set<number>();

	for (let step = 1; step < n; step++) {
		let bestA = -1;
		let bestB = -1;
		let bestD = Infinity;
		for (let i = 0; i < n; i++) {
			if (!inTree[i]) continue;
			for (let j = 0; j < n; j++) {
				if (inTree[j]) continue;
				const d = Math.hypot(
					active[i].cx - active[j].cx,
					active[i].cy - active[j].cy,
				);
				if (d < bestD) {
					bestD = d;
					bestA = i;
					bestB = j;
				}
			}
		}
		if (bestA < 0) break;
		inTree[bestB] = 1;
		mst.push({ a: bestA, b: bestB, d: bestD });
		used.add(edgeKey(bestA, bestB));
	}
	mst.sort((u, v) => u.d - v.d);

	const chosen: { a: number; b: number; d: number }[] = [];
	if (density <= 0.45) {
		const take = Math.max(1, Math.round(mst.length * (density / 0.45)));
		for (let i = 0; i < Math.min(take, mst.length); i++) chosen.push(mst[i]);
	} else {
		chosen.push(...mst);
		// Add shortest proximity chords for higher density settings.
		const extras: { a: number; b: number; d: number }[] = [];
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				if (used.has(edgeKey(i, j))) continue;
				const d = Math.hypot(
					active[i].cx - active[j].cx,
					active[i].cy - active[j].cy,
				);
				extras.push({ a: i, b: j, d });
			}
		}
		extras.sort((u, v) => u.d - v.d);
		const maxExtra = Math.min(extras.length, Math.max(1, Math.round(n * 1.2)));
		const take = Math.round(maxExtra * ((density - 0.45) / 0.55));
		for (let i = 0; i < take; i++) chosen.push(extras[i]);
	}

	const pad = Math.max(3, 4 * scaleRef);
	const dotR = Math.max(1.2, lw * 0.62);
	const midX = width * 0.5;
	const midY = height * 0.5;

	ctx.lineWidth = Math.max(1, lw * 0.55);
	ctx.setLineDash([]);

	for (const e of chosen) {
		const ga = active[e.a];
		const gb = active[e.b];
		const dx = gb.cx - ga.cx;
		const dy = gb.cy - ga.cy;
		const dist = Math.hypot(dx, dy);
		if (dist < 1) continue;
		const ux = dx / dist;
		const uy = dy / dist;

		// Intersect ray from each center with its box perimeter (+ breathing gap).
		const offA = boxRayExit(ga.bw * 0.5 + pad, ga.bh * 0.5 + pad, ux, uy);
		const offB = boxRayExit(gb.bw * 0.5 + pad, gb.bh * 0.5 + pad, -ux, -uy);
		const span = dist - offA - offB;
		if (span < 8 * scaleRef) continue;

		const x0 = ga.cx + ux * offA;
		const y0 = ga.cy + uy * offA;
		const x1 = gb.cx - ux * offB;
		const y1 = gb.cy - uy * offB;

		const isPrimaryEdge = ga.box.primary || gb.box.primary;
		const edgeAlpha =
			Math.min(ga.alpha, gb.alpha) * (isPrimaryEdge ? 0.62 : 0.46) * strokeFade;
		ctx.globalAlpha = edgeAlpha;

		ctx.beginPath();
		ctx.moveTo(x0, y0);
		if (span > minDim * 0.14) {
			// Gentle coherent bow oriented away from frame center (editorial constellation).
			const mx = (x0 + x1) * 0.5;
			const my = (y0 + y1) * 0.5;
			const nx = -uy;
			const ny = ux;
			const sign = (mx - midX) * nx + (my - midY) * ny >= 0 ? 1 : -1;
			const bow = Math.min(minDim * 0.042, span * 0.075) * sign;
			ctx.quadraticCurveTo(mx + nx * bow, my + ny * bow, x1, y1);
		} else {
			ctx.lineTo(x1, y1);
		}
		ctx.stroke();

		// Tiny precision anchor pips at both box-perimeter attachment points.
		ctx.globalAlpha = Math.min(1, edgeAlpha * 1.35);
		ctx.beginPath();
		ctx.arc(x0, y0, dotR, 0, Math.PI * 2);
		ctx.arc(x1, y1, dotR, 0, Math.PI * 2);
		ctx.fill();
	}
}

/** Distance from center of a half-extents (hx, hy) box to its perimeter along unit (ux, uy). */
function boxRayExit(hx: number, hy: number, ux: number, uy: number): number {
	const tx = Math.abs(ux) > 1e-5 ? hx / Math.abs(ux) : Infinity;
	const ty = Math.abs(uy) > 1e-5 ? hy / Math.abs(uy) : Infinity;
	return Math.min(tx, ty);
}

/** Draw scalable, edge-clamped monospace telemetry labels around a target box. */
function drawBoxLabels(
	ctx: CanvasRenderingContext2D,
	g: BoxGeom,
	width: number,
	height: number,
	baseFont: number,
	labelAlpha: number,
	labelMode: TrackingParams["labels"],
	hudStyle: TrackingParams["hudStyle"],
	scaleRef: number,
): void {
	const { box, x, y, bw, bh, alpha } = g;
	const lost = box.state === "lost";
	const extraClearance =
		hudStyle === "reticle"
			? Math.max(
					3.5 * scaleRef,
					Math.min(9.5 * scaleRef, Math.min(bw, bh) * 0.09),
				)
			: 0;
	const pad = Math.max(3, baseFont * 0.44) + extraClearance;
	const edge = 4;

	if (box.label && labelAlpha > 0) {
		const size = box.primary || lost ? baseFont : Math.max(1, baseFont * 0.84);
		const weight = box.primary || lost ? 600 : 500;
		ctx.font = font(size, weight);
		const showPip = box.primary && !lost && labelMode === "full";
		const pip = showPip ? Math.max(2, size * 0.38) : 0;
		const pipGap = showPip ? Math.max(3, size * 0.36) : 0;
		const textW = ctx.measureText(box.label).width;
		const totalW = pip + pipGap + textW;

		// Keep label inside the frame horizontally and flip below if too close to top edge.
		const tx = Math.max(edge, Math.min(width - totalW - edge, x));
		let ty = y - pad;
		if (ty - size < edge) {
			ty = y + bh + pad + size * 0.88;
		}
		ty = Math.min(height - edge, Math.max(edge + size * 0.85, ty));

		ctx.globalAlpha = Math.min(
			1,
			labelAlpha * (box.primary || lost ? 1 : 0.88),
		);
		if (showPip) {
			ctx.fillRect(tx, ty - size * 0.56, pip, pip);
		}
		ctx.fillText(box.label, tx + pip + pipGap, ty);
	}

	if (box.sub && alpha > 0) {
		const subSize = Math.max(1, baseFont * 0.8);
		ctx.font = font(subSize, 500);
		const textW = ctx.measureText(box.sub).width;
		const tx = Math.max(edge, Math.min(width - textW - edge, x));
		let ty = y + bh + pad + subSize * 0.88;
		if (ty > height - edge) {
			ty = Math.max(edge + subSize, y - pad - baseFont - pad * 0.6);
		}
		ctx.globalAlpha = Math.min(1, alpha * 0.82);
		ctx.fillText(box.sub, tx, ty);
	}
}
