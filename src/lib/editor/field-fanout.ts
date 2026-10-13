/** One clip's or lane's panel edit, carried field by field to the rest of a multi-selection. */

import type { MediaClip, MediaLane } from "../media";
import { DEFAULT_LANE_AUDIO } from "../mix/types";

function sameValue(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** `target` with the `keys` that changed from `before` to `after`; `target` itself when none did. */
export function withChangedFields<T extends object>(
	before: T,
	after: T,
	target: T,
	keys: readonly (keyof T)[],
): T {
	const changed = keys.filter((k) => !sameValue(before[k], after[k]));
	if (changed.length === 0) return target;
	const next = { ...target };
	for (const k of changed) {
		const v = after[k];
		if (v === undefined) delete next[k];
		else next[k] = v && typeof v === "object" ? { ...v } : v;
	}
	return next;
}

/** What a media clip's panel sets that means the same on any clip. What it plays,
 * where it starts and how fast stay each clip's own. */
const SHARED_MEDIA_CLIP_FIELDS = [
	"fadeInSec",
	"fadeOutSec",
	"transition",
	"gain",
	"bounce",
] as const satisfies readonly (keyof MediaClip)[];

export function fanOutMediaClipFields(
	before: MediaClip,
	after: MediaClip,
	target: MediaClip,
): MediaClip {
	const next = withChangedFields(
		before,
		after,
		target,
		SHARED_MEDIA_CLIP_FIELDS,
	);
	// Turning bounce on or off starts every clip on a forward pass, as the panel does.
	if (next.bounce !== target.bounce) delete next.bounceBack;
	return next;
}

/** The lane's placement and sound, as `before` → `after` changed them, on `target`. */
export function fanOutMediaLaneEdit(
	before: MediaLane,
	after: MediaLane,
	target: MediaLane,
): MediaLane {
	const style = withChangedFields(
		before.style,
		after.style,
		target.style,
		Object.keys(after.style) as (keyof MediaLane["style"])[],
	);
	const audio = withChangedFields(
		before.audio ?? DEFAULT_LANE_AUDIO,
		after.audio ?? DEFAULT_LANE_AUDIO,
		target.audio ?? DEFAULT_LANE_AUDIO,
		["muted", "drives"],
	);
	const audioChanged = audio !== (target.audio ?? DEFAULT_LANE_AUDIO);
	if (style === target.style && !audioChanged) return target;
	return { ...target, style, ...(audioChanged ? { audio } : {}) };
}
