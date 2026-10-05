import { DEFAULT_DAB_CORE } from "../brush/soft-dab";

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
	/** 0 = hard edge, 1 = fading from the centre. The default is the eraser's brush. */
	softness: 1 - DEFAULT_DAB_CORE,
	/** Paint the effects back out instead of in. */
	erase: false,
	/** The Mask whose area the user asked to see. Only Show area sets it. */
	shownId: null as string | null,
	/** A Mask being changed right now, whose area shows until the change settles. */
	peekId: null as string | null,
	/** The Mask whose Show area button the pointer rests on. */
	hoverId: null as string | null,
	/** The Key shape's colour whose settings the card shows. */
	keyIndex: 0,
});

/** How long the area stays up after the last change, in ms. */
const PEEK_MS = 700;
let peekTimer: ReturnType<typeof setTimeout> | undefined;

/** Show Mask `id`'s area while it changes; each call restarts the clock, so a
 * slider drag keeps it up until the drag stops. */
export function peekArea(id: string) {
	maskPaint.peekId = id;
	clearTimeout(peekTimer);
	peekTimer = setTimeout(() => {
		if (maskPaint.peekId === id) maskPaint.peekId = null;
	}, PEEK_MS);
}

/** The Mask whose area the preview tints right now, if any. */
export function tintedMask(): string | null {
	return maskPaint.shownId ?? maskPaint.hoverId ?? maskPaint.peekId;
}

/** Key for the context a media clip's panel sets, so its Masks paint in its box. */
export const MASK_LANE_CONTEXT = Symbol("mask-lane");
