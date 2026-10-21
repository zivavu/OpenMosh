import {
	clampCrop,
	isFullCrop,
	MIN_CROP_SIZE,
	type CropRect,
} from "./source-edit";

/** Dragging a crop rectangle over a picture, in normalized coordinates. */

export interface Point {
	x: number;
	y: number;
}

/** Which sides of the rectangle a resize drag is holding. */
export type Edges = { l: boolean; r: boolean; t: boolean; b: boolean };

export type CropDrag =
	| { kind: "new"; ax: number; ay: number }
	| { kind: "move"; dx: number; dy: number }
	| { kind: "resize"; edges: Edges; from: CropRect };

/** How close to an edge counts as grabbing it, for a picture `width`×`height` px on screen. */
export function grabTolerance(
	crop: CropRect,
	width: number,
	height: number,
	px = 10,
): Point {
	return {
		x: Math.min(width ? px / width : 0.02, crop.w / 3),
		y: Math.min(height ? px / height : 0.02, crop.h / 3),
	};
}

/** The edges under `n`, or null if it isn't near any of them. */
export function edgesAt(crop: CropRect, n: Point, tol: Point): Edges | null {
	if (isFullCrop(crop)) return null;
	// Outside the rectangle by more than the grab distance is a new rectangle.
	if (
		n.x < crop.x - tol.x ||
		n.x > crop.x + crop.w + tol.x ||
		n.y < crop.y - tol.y ||
		n.y > crop.y + crop.h + tol.y
	) {
		return null;
	}
	const edges: Edges = {
		l: Math.abs(n.x - crop.x) <= tol.x,
		r: Math.abs(n.x - (crop.x + crop.w)) <= tol.x,
		t: Math.abs(n.y - crop.y) <= tol.y,
		b: Math.abs(n.y - (crop.y + crop.h)) <= tol.y,
	};
	return edges.l || edges.r || edges.t || edges.b ? edges : null;
}

export function insideCrop(crop: CropRect, n: Point): boolean {
	return (
		!isFullCrop(crop) &&
		n.x > crop.x &&
		n.x < crop.x + crop.w &&
		n.y > crop.y &&
		n.y < crop.y + crop.h
	);
}

export function cropCursor(edges: Edges | null): string {
	if (!edges) return "";
	if ((edges.l && edges.t) || (edges.r && edges.b)) return "nwse-resize";
	if ((edges.r && edges.t) || (edges.l && edges.b)) return "nesw-resize";
	if (edges.l || edges.r) return "ew-resize";
	return "ns-resize";
}

/** On an edge a press resizes, inside it moves, anywhere else starts a new rectangle. */
export function startCropDrag(
	crop: CropRect,
	n: Point,
	tol: Point,
): { drag: CropDrag; crop: CropRect | null } {
	const edges = edgesAt(crop, n, tol);
	if (edges)
		return { drag: { kind: "resize", edges, from: { ...crop } }, crop: null };
	if (insideCrop(crop, n)) {
		return {
			drag: { kind: "move", dx: n.x - crop.x, dy: n.y - crop.y },
			crop: null,
		};
	}
	return {
		drag: { kind: "new", ax: n.x, ay: n.y },
		crop: clampCrop({ x: n.x, y: n.y, w: MIN_CROP_SIZE, h: MIN_CROP_SIZE }),
	};
}

/** The rectangle once the pointer of `drag` is at `n`. */
export function dragCrop(drag: CropDrag, crop: CropRect, n: Point): CropRect {
	if (drag.kind === "resize") {
		const { edges, from } = drag;
		// The held edges follow the pointer, the opposite ones stay put.
		let x0 = from.x;
		let y0 = from.y;
		let x1 = from.x + from.w;
		let y1 = from.y + from.h;
		// An edge stops at the opposite one rather than crossing it.
		if (edges.l) x0 = Math.min(n.x, x1 - MIN_CROP_SIZE);
		if (edges.r) x1 = Math.max(n.x, x0 + MIN_CROP_SIZE);
		if (edges.t) y0 = Math.min(n.y, y1 - MIN_CROP_SIZE);
		if (edges.b) y1 = Math.max(n.y, y0 + MIN_CROP_SIZE);
		return clampCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
	}
	if (drag.kind === "new") {
		return clampCrop({
			x: Math.min(drag.ax, n.x),
			y: Math.min(drag.ay, n.y),
			w: Math.abs(n.x - drag.ax),
			h: Math.abs(n.y - drag.ay),
		});
	}
	return clampCrop({
		x: Math.min(Math.max(n.x - drag.dx, 0), 1 - crop.w),
		y: Math.min(Math.max(n.y - drag.dy, 0), 1 - crop.h),
		w: crop.w,
		h: crop.h,
	});
}
