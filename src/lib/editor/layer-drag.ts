import type { MediaStyle } from "../media/types";

/** The slider's floor, so a handle can't drag a layer past where the
 * panel could bring it back from. */
export const MIN_SCALE = 0.05;

/** The box's geometry at the press, in output pixels — what `mediaLayerRect`
 * reports, with the pressed handle's offset from the centre kept in the box's
 * own (pre-rotation) frame. */
export interface HandleFrame {
	/** Which handle: -1/0/1 per axis, corners on both. */
	hx: -1 | 0 | 1;
	hy: -1 | 0 | 1;
	cx: number;
	cy: number;
	rot: number;
	c0x: number;
	c0y: number;
}

/**
 * The style after a handle drag, with the dragged edge landing on the cursor.
 * The pointer and frame are in output pixels; the style's normalized units are
 * only produced here, at the end.
 *
 * The factor is measured from the anchored opposite edge — half the pointer's
 * travel past the handle, since the centre shifts to keep that edge put.
 * Alt anchors the centre instead, where the full travel is the factor.
 */
export function scaleFromHandle(
	from: MediaStyle,
	g: HandleFrame,
	px: number,
	py: number,
	fw: number,
	fh: number,
	alt: boolean,
): MediaStyle {
	const dx = px - g.cx;
	const dy = py - g.cy;
	const cos = Math.cos(g.rot);
	const sin = Math.sin(g.rot);
	// The pointer in the box's own frame, so a rotated layer scales along
	// its own edges rather than the screen's.
	const lx = dx * cos + dy * sin;
	const ly = -dx * sin + dy * cos;
	let fx = 1;
	let fy = 1;
	const next = { ...from };
	if (g.hx !== 0 && g.hy !== 0) {
		const p = (lx * g.c0x + ly * g.c0y) / (g.c0x * g.c0x + g.c0y * g.c0y);
		fx = fy = Math.max(alt ? p : 0.5 + p / 2, MIN_SCALE / from.scale);
		next.scale = from.scale * fx;
	} else if (g.hx !== 0) {
		const p = lx / g.c0x;
		fx = Math.max(alt ? p : 0.5 + p / 2, MIN_SCALE / from.scaleX);
		next.scaleX = from.scaleX * fx;
	} else {
		const p = ly / g.c0y;
		fy = Math.max(alt ? p : 0.5 + p / 2, MIN_SCALE / from.scaleY);
		next.scaleY = from.scaleY * fy;
	}
	// The opposite side stays put unless Alt asks for the centre to: the
	// handle's offset grows by the factor, and the centre moves by the
	// difference, turned back into frame space.
	if (!alt) {
		const mx = (fx - 1) * g.c0x;
		const my = (fy - 1) * g.c0y;
		next.x = from.x + (mx * cos - my * sin) / fw;
		next.y = from.y + (mx * sin + my * cos) / fh;
	}
	return next;
}