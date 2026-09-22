// Straight from the module, not the barrel: that re-exports the custom-font store.
import { overlayTextBox } from "../text-overlay/draw";
import type { ResolvedMediaLayer } from "../media";
import type { ResolvedTextLayer } from "../text";

/** Picking a layer by clicking the preview. */
export interface LayerHitBox {
	kind: "media" | "text";
	laneId: string;
	/** Composited ahead of the main chain, so always beneath the layers that aren't. */
	underEffects: boolean;
	z: number;
	/** Centre, size and rotation in output pixels. */
	cx: number;
	cy: number;
	w: number;
	h: number;
	rot: number;
}

/** What a click on the preview landed on: a layer, or the image every layer sits over. */
export type LayerPick =
	{ kind: "media" | "text"; laneId: string } | { kind: "base" };

/** Where a media lane's placement lands, in output pixels. */
export interface MediaRect {
	x: number;
	y: number;
	w: number;
	h: number;
	rot: number;
}

export function pointInLayer(
	box: LayerHitBox,
	px: number,
	py: number,
): boolean {
	if (box.w <= 0 || box.h <= 0) return false;
	const dx = px - box.cx;
	const dy = py - box.cy;
	// Into the box's own frame, so a rotated layer is hit where it looks like it is.
	const cos = Math.cos(-box.rot);
	const sin = Math.sin(-box.rot);
	return (
		Math.abs(dx * cos - dy * sin) <= box.w / 2 &&
		Math.abs(dx * sin + dy * cos) <= box.h / 2
	);
}

/** The layer a click at `px`, `py` lands on: the one drawn last of those it hits. */
export function pickTopLayer(
	boxes: LayerHitBox[],
	px: number,
	py: number,
): LayerHitBox | null {
	let top: LayerHitBox | null = null;
	for (const box of boxes) {
		if (!pointInLayer(box, px, py)) continue;
		if (!top || drawnAfter(box, top)) top = box;
	}
	return top;
}

/** Composite order between two layers: over the chain beats under it, then z. */
function drawnAfter(box: LayerHitBox, other: LayerHitBox): boolean {
	if (box.underEffects !== other.underEffects) return !box.underEffects;
	return box.z >= other.z;
}

/** Boxes for everything on screen this frame. */
export function layerHitBoxes(
	media: ResolvedMediaLayer[],
	text: ResolvedTextLayer[],
	frameW: number,
	frameH: number,
	mediaRect: (layer: ResolvedMediaLayer) => MediaRect | null,
): LayerHitBox[] {
	const boxes: LayerHitBox[] = [];
	for (const layer of media) {
		const rect = mediaRect(layer);
		if (!rect) continue;
		boxes.push({
			kind: "media",
			laneId: layer.laneId,
			underEffects: layer.underEffects,
			z: layer.z,
			cx: rect.x + rect.w / 2,
			cy: rect.y + rect.h / 2,
			w: rect.w,
			h: rect.h,
			rot: rect.rot,
		});
	}
	for (const layer of text) {
		const box = overlayTextBox(frameW, frameH, layer.text, layer.style);
		if (!box) continue;
		boxes.push({
			kind: "text",
			laneId: layer.laneId,
			underEffects: layer.underEffects,
			z: layer.z,
			cx: box.x + box.w / 2,
			cy: box.y + box.h / 2,
			w: box.w,
			h: box.h,
			rot: 0,
		});
	}
	return boxes;
}
