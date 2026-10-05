import {
	clampMove,
	rotateFromHandle,
	scaleFromHandle,
	type HandleFrame,
} from "../../editor/layer-drag";
import { DEFAULT_MEDIA_STYLE, type MediaStyle } from "../../media/types";

/** A Mask's Ellipse, Rectangle or Gradient as its params hold it. `x`,`y` are the
 * box's uv; `width`,`height` are in its short edge; `angle` turns clockwise. */
export interface ShapeValues {
	x: number;
	y: number;
	width: number;
	height: number;
	angle: number;
}

export const SHAPE_KEYS = ["x", "y", "width", "height", "angle"] as const;
/** The Image shape's own size params, multiples of its Fit; same order. */
export const IMAGE_SHAPE_KEYS = [
	"x",
	"y",
	"imageWidth",
	"imageHeight",
	"angle",
] as const;

/** The params' own ranges (catalog/mask.ts). */
const SIZE_MAX = 2;

/** The shape's params, or the Image shape's with its size multiples as width and height. */
export function readShape(
	values: Record<string, number | string>,
	image = false,
): ShapeValues {
	const n = (k: string, d: number) =>
		typeof values[k] === "number" ? (values[k] as number) : d;
	const size = image ? 1 : 0.6;
	return {
		x: n("x", 0.5),
		y: n("y", 0.5),
		width: n(image ? "imageWidth" : "width", size),
		height: n(image ? "imageHeight" : "height", size),
		angle: n("angle", 0),
	};
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));

/** Held to what the sliders can show, so a drag never leaves them pinned. */
export function clampShape(s: ShapeValues, sizeMax = SIZE_MAX): ShapeValues {
	return {
		x: clamp(s.x, 0, 1),
		y: clamp(s.y, 0, 1),
		width: clamp(s.width, 0, sizeMax),
		height: clamp(s.height, 0, sizeMax),
		angle: clamp(s.angle, -180, 180),
	};
}

/** A loaded image's size at Width and Height 1, in short-edge units of a box
 * `boxAspect` wide: the Fit setting's rectangle. Mirrors imageCoverage in mask.ts. */
export function imageBase(
	imageAspect: number,
	boxAspect: number,
	fit: string,
): { w: number; h: number } {
	const r = imageAspect / boxAspect;
	let size = { w: 1, h: 1 };
	if (fit === "cover") size = r > 1 ? { w: r, h: 1 } : { w: 1, h: 1 / r };
	else if (fit === "contain")
		size = r > 1 ? { w: 1, h: 1 / r } : { w: r, h: 1 };
	// The box's uv in its short edge: (aspect, 1) when wide, (1, 1 / aspect) when tall.
	const sx = Math.max(boxAspect, 1);
	const sy = Math.max(1 / boxAspect, 1);
	return { w: size.w * sx, h: size.h * sy };
}

/** The shape in a `w` x `h` pixel box: centre, size and turn (radians). */
export function shapeGeometry(s: ShapeValues, w: number, h: number) {
	const unit = Math.min(w, h);
	return {
		cx: s.x * w,
		cy: s.y * h,
		sw: s.width * unit,
		sh: s.height * unit,
		rot: (s.angle * Math.PI) / 180,
	};
}

/** The shape as a layer style at scale 1, so the layers' drag math can move it. */
function asStyle(s: ShapeValues): MediaStyle {
	return {
		...DEFAULT_MEDIA_STYLE,
		x: s.x,
		y: s.y,
		scale: 1,
		scaleX: 1,
		scaleY: 1,
		rotation: s.angle,
	};
}

export function moveShape(
	from: ShapeValues,
	dx: number,
	dy: number,
	w: number,
	h: number,
	sizeMax?: number,
): ShapeValues {
	const g = shapeGeometry(from, w, h);
	const cos = Math.abs(Math.cos(g.rot));
	const sin = Math.abs(Math.sin(g.rot));
	const hw = (g.sw * cos + g.sh * sin) / 2;
	const hh = (g.sw * sin + g.sh * cos) / 2;
	return clampShape(
		{ ...from, ...clampMove(asStyle(from), dx, dy, hw, hh, w, h) },
		sizeMax,
	);
}

/** The handle frame for handle `hx`,`hy` of the shape, for scaleShape. */
export function shapeHandle(
	s: ShapeValues,
	hx: -1 | 0 | 1,
	hy: -1 | 0 | 1,
	w: number,
	h: number,
): HandleFrame {
	const g = shapeGeometry(s, w, h);
	return {
		hx,
		hy,
		cx: g.cx,
		cy: g.cy,
		rot: g.rot,
		c0x: (hx * g.sw) / 2,
		c0y: (hy * g.sh) / 2,
	};
}

export function scaleShape(
	from: ShapeValues,
	g: HandleFrame,
	px: number,
	py: number,
	w: number,
	h: number,
	alt: boolean,
	sizeMax?: number,
): ShapeValues {
	const next = scaleFromHandle(asStyle(from), g, px, py, w, h, alt);
	return clampShape(
		{
			x: next.x,
			y: next.y,
			width: from.width * next.scale * next.scaleX,
			height: from.height * next.scale * next.scaleY,
			angle: from.angle,
		},
		sizeMax,
	);
}

export function rotateShape(
	from: ShapeValues,
	g: { cx: number; cy: number; a0: number },
	px: number,
	py: number,
	snap: boolean,
): ShapeValues {
	return { ...from, angle: rotateFromHandle(asStyle(from), g, px, py, snap) };
}
