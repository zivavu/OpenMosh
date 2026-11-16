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

export function easeLabel(ease: KeyEase | "mixed" | undefined): string {
	if (ease === "mixed") return "mixed eases";
	return EASE_OPTIONS.find((o) => o.ease === ease)?.label ?? "Linear";
}
