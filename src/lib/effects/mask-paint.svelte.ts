/** A Mask effect the preview is taking brush strokes or colour picks for. */
export interface MaskPaintTarget {
	instanceId: string;
	/** Painting with the brush, picking the Key shape's colours, or moving and
	 * sizing an Ellipse, Rectangle or Gradient. */
	tool: "paint" | "keys" | "shape";
	/** The Mask's shape when the tool started. */
	shape: string;
	/** The param the tool edits, as the effect holds it now. */
	current: () => string;
	/** Set when the chain is a media clip's: the painting covers that layer's box. */
	laneId: string | null;
	/** Called per stroke, pick or tool undo, with the whole param. */
	commit: (url: string, history: ParamHistory) => void;
	/** The Image shape's picture and Fit, which set its size at Width and Height 1. */
	image?: () => { url: string; fit: string };
	/** False once the Mask is off or no longer a brush; painting ends then. */
	alive: () => boolean;
}

/** "new" starts its own undo entry; "none" rides on the one before it. */
export type ParamHistory = "new" | "none";

/** Shared by the Mask's card, which starts and ends painting, and the preview,
 * which takes the strokes. */
export const maskPaint = $state({
	target: null as MaskPaintTarget | null,
	/** Brush diameter as a share of the painted box's long edge. */
	size: 0.1,
	/** 0 = hard edge, 1 = fading from the centre. */
	softness: 0.4,
	/** Paint the effects back out instead of in. */
	erase: false,
	/** The Mask whose area the user asked to see. Only Show area sets it. */
	shownId: null as string | null,
	/** The Mask whose Show area button the pointer rests on. */
	hoverId: null as string | null,
	/** A Key colour pointed at or dragged: the tint shows only what it selects. */
	keyFocus: null as { instanceId: string; index: number } | null,
	/** The Key shape's colour whose settings the card shows. */
	keyIndex: 0,
});

/** The Mask whose area the preview tints right now, if any. */
export function tintedMask(): string | null {
	return (
		maskPaint.shownId ??
		maskPaint.hoverId ??
		maskPaint.keyFocus?.instanceId ??
		null
	);
}

/** Key for the context a media clip's panel sets, so its Masks paint in its box. */
export const MASK_LANE_CONTEXT = Symbol("mask-lane");
