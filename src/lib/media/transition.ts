/** How a media clip blends in from the clip before it on its lane. */

import { mulberry32, randomSeed } from "../rng";

export type TransitionType =
	| "cut"
	| "rgbslip"
	| "slam"
	| "whip"
	| "shatter"
	| "burn"
	| "crosswarp"
	| "crosszoom"
	| "cube"
	/** One of the blends above per clip, seeded. */
	| "random";

export interface ClipTransition {
	type: TransitionType;
	/** Seconds the blend runs from the clip's start. */
	durationSec: number;
	/** Keeps seeded layouts identical between preview and export. */
	seed: number;
	/** 0=→ 1=← 2=↓ 3=↑, or RANDOM_DIRECTION. */
	direction?: number;
	/** "shatter" cell size: 0=coarse 1=medium 2=fine. */
	density?: number;
}

export const RANDOM_DIRECTION = -1;

/** What one blend renders once any random picks are made. */
export interface ConcreteTransition {
	type: Exclude<TransitionType, "cut" | "random">;
	direction: number;
	density: number;
}

export const TRANSITION_OPTIONS: {
	value: TransitionType;
	label: string;
	hasDirection?: boolean;
	hasDensity?: boolean;
	hasSeed?: boolean;
}[] = [
	{ value: "cut", label: "cut" },
	{ value: "rgbslip", label: "rgb slip", hasSeed: true },
	{ value: "slam", label: "slam" },
	{ value: "whip", label: "whip", hasDirection: true, hasSeed: true },
	{ value: "shatter", label: "shatter", hasDensity: true, hasSeed: true },
	{ value: "burn", label: "burn", hasSeed: true },
	{ value: "crosswarp", label: "crosswarp", hasDirection: true },
	{ value: "crosszoom", label: "cross zoom" },
	{ value: "cube", label: "cube", hasDirection: true },
	{ value: "random", label: "random", hasSeed: true },
];

const RANDOM_TYPE_POOL = TRANSITION_OPTIONS.map((o) => o.value).filter(
	(t): t is ConcreteTransition["type"] => t !== "cut" && t !== "random",
);

const LIVE_TYPES = new Set<string>(TRANSITION_OPTIONS.map((o) => o.value));

export const DEFAULT_TRANSITION_DURATION = 0.5;

export const TRANSITION_DURATIONS = [0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.2, 2];

export function createTransition(type: TransitionType): ClipTransition {
	return { type, durationSec: DEFAULT_TRANSITION_DURATION, seed: randomSeed() };
}

/** Random picks drawn from the seed and the clip's start, so export matches preview. */
export function resolveConcreteTransition(
	transition: ClipTransition,
	at: number,
): ConcreteTransition | null {
	if (transition.type === "cut") return null;
	const rng = mulberry32((transition.seed ^ Math.round(at * 1000)) >>> 0);
	const randomType = transition.type === "random";
	const type = randomType
		? RANDOM_TYPE_POOL[Math.floor(rng() * RANDOM_TYPE_POOL.length)]
		: (transition.type as ConcreteTransition["type"]);
	const direction = transition.direction ?? 0;
	return {
		type,
		direction:
			randomType || direction === RANDOM_DIRECTION
				? Math.floor(rng() * 4)
				: direction,
		density: randomType ? Math.floor(rng() * 3) : (transition.density ?? 1),
	};
}

/** Seconds the blend actually runs: never past the clip's own end. */
export function transitionLength(clip: {
	start: number;
	end: number;
	transition?: ClipTransition;
}): number {
	const t = clip.transition;
	if (!t || t.type === "cut") return 0;
	return Math.max(0, Math.min(t.durationSec, clip.end - clip.start));
}

/** A saved transition, or undefined for a cut or anything this build doesn't ship. */
export function normalizeClipTransition(
	raw: unknown,
): ClipTransition | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const t = raw as Partial<ClipTransition>;
	if (typeof t.type !== "string" || !LIVE_TYPES.has(t.type)) return undefined;
	if (t.type === "cut") return undefined;
	const durationSec =
		typeof t.durationSec === "number" && t.durationSec > 0
			? t.durationSec
			: DEFAULT_TRANSITION_DURATION;
	return {
		type: t.type,
		durationSec,
		seed: typeof t.seed === "number" ? t.seed : randomSeed(),
		direction: typeof t.direction === "number" ? t.direction : undefined,
		density: typeof t.density === "number" ? t.density : undefined,
	};
}
