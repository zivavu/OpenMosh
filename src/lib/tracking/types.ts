import type { BlocksState } from "./blocks";

/** The defId this overlay effect is registered under in EFFECT_DEFINITIONS. */
export const TRACKING_EFFECT_ID = "tracking";

/** Per-box lifecycle: lock → degraded → lost → reacquire → lock. */
export type BoxState = "lock" | "degraded" | "lost" | "reacquire";

export type TrackingMode = "hud" | "blocks";
export type BlockFollow = "light" | "motion" | "detail";
export type BlockFill = "invert" | "heat" | "hue" | "mix";

export interface TrackingParams {
	mode: TrackingMode;
	count: number;
	/** Blocks look: how many boxes, what they follow, how they fill, how many arcs (0..1). */
	blocks: number;
	follow: BlockFollow;
	fill: BlockFill;
	links: number;
	/** 0..1: how selective the saliency picker is (higher = only strongest spots). */
	sensitivity: number;
	/** Base box size as a fraction of the smaller image dimension. */
	size: number;
	/** Stroke width, in px at a 720px reference height (scaled to actual size). */
	thickness: number;
	/** 0..1 overall overlay opacity. */
	opacity: number;
	color: "white" | "black";
}

/** A salient point in normalized coords (x: left→right, y: top→bottom). */
export interface SalPoint {
	x: number;
	y: number;
	score: number;
}

/** A persistent tracked box (locked spot + identity), independent of per-frame jitter. */
export interface TrackBox {
	/** Stable slot index, used to derive deterministic noise/ids. */
	key: number;
	/** 4-char hex identity shown in the label. */
	hex: string;
	/** Tracked normalized center. Frozen while `state` is "lost". */
	baseX: number;
	baseY: number;
	w: number;
	h: number;
	/** Signal quality 0..1 from how well the template matches. Drops fast when the
	 * target is disturbed, recovers slowly, like a real tracker losing and
	 * re-confirming a lock. */
	quality: number;
	state: BoxState;
	/** Animation-time of the last state transition (drives state animations). */
	stateChangedAt: number;
	/** Display position smoothed toward baseX/baseY (avoids 8 Hz stepping). */
	drawX: number;
	drawY: number;
	/** Animation-time the box was (re)acquired, for fade-in. */
	acquiredAt: number;
	/** What the target looks like: a zero-mean, unit-length luminance patch.
	 * Null until the next tick captures it. */
	template: Float32Array | null;
	/** Velocity in normalized units per second, to predict where to search. */
	vx: number;
	vy: number;
}

export interface TrackingState {
	boxes: TrackBox[];
	salPoints: SalPoint[];
	/** Animation-time of the last saliency analysis (-1 = never). */
	lastAnalyze: number;
	/** Animation-time of the last tracking tick (-1 = never); gaps = scene cut. */
	lastTick: number;
	/** Signature of placement-affecting params; change forces re-acquire. */
	signature: string;
	/** Previous downsampled luminance grid (row-major, top-first). */
	prevLum: Float32Array | null;
	gridW: number;
	gridH: number;
	/** Global feed disturbance 0..1: mean frame-to-frame luminance change,
	 * rising instantly and decaying over a few ticks. High means "the whole
	 * feed is glitching", not "my target moved". */
	disturbance: number;
	/** Key of the current primary (designated) target, -1 = none. */
	primaryKey: number;
	/** The Blocks look's state, made on its first tick. */
	blocks?: BlocksState;
}

export interface FrameBox {
	cx: number;
	cy: number;
	w: number;
	h: number;
	hex: string;
	state: BoxState;
	/** Seconds since the box entered its current state (drives animations). */
	stateAge: number;
	/** True for the designated primary target (drone style hierarchy). */
	primary: boolean;
	/** Primary label line (status). Empty = no label. */
	label: string;
	/** Secondary label line (coords). Empty = no label. */
	sub: string;
	/** 0..1 fade-in alpha. */
	alpha: number;
}

export interface TrackingFrame {
	boxes: FrameBox[];
	/** Global feed disturbance 0..1 (drives frame chrome: blinks, stutters). */
	disturbance: number;
}
