import type { KeyEase } from "../keyframes";

/** The eases a key's menu offers, in its order. Each shapes the stretch from the
 * key to the next one. */
export const EASE_OPTIONS: { ease: KeyEase | undefined; label: string }[] = [
	{ ease: undefined, label: "Linear" },
	{ ease: "smooth", label: "Smooth start and stop" },
	{ ease: "in", label: "Speed up into it" },
	{ ease: "out", label: "Slow down into it" },
	{ ease: "overshoot", label: "Overshoot and settle" },
	{ ease: "bounce", label: "Bounce" },
	{ ease: "hold", label: "Hold, then jump" },
];

export const EASE_HEADING = "To the next key";

/** The beat lengths a selection of keys can repeat at. */
export const REPEAT_OPTIONS = [
	{ beats: 1, label: "Repeat the selection every beat" },
	{ beats: 2, label: "Repeat the selection every 2 beats" },
	{ beats: 4, label: "Repeat the selection every bar" },
];

/** The repeats a selection spanning `span` seconds fits, at `beatSec` a beat. */
export function repeatsFor(span: number, beatSec: number) {
	if (!(beatSec > 0)) return [];
	return REPEAT_OPTIONS.filter((o) => o.beats * beatSec > span + 1e-3);
}

export function easeLabel(ease: KeyEase | "mixed" | undefined): string {
	if (ease === "mixed") return "mixed eases";
	return EASE_OPTIONS.find((o) => o.ease === ease)?.label ?? "Linear";
}
