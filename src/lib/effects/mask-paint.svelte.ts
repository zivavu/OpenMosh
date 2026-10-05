/** A Mask effect whose painting the preview is taking strokes for. */
export interface MaskPaintTarget {
	instanceId: string;
	/** The painting the effect holds now; "" for none. */
	current: () => string;
	/** Set when the chain is a media clip's: the painting covers that layer's box. */
	laneId: string | null;
	/** Called once per stroke, or brush undo, with the whole painting. */
	commit: (url: string, history: ParamHistory) => void;
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
	/** 0 = hard edge, 1 = blurred well past the brush. */
	softness: 0.5,
	/** Paint the effects back out instead of in. */
	erase: false,
	/** The Mask whose area the preview tints, besides the one being painted. */
	shownId: null as string | null,
});

/** Key for the context a media clip's panel sets, so its Masks paint in its box. */
export const MASK_LANE_CONTEXT = Symbol("mask-lane");
