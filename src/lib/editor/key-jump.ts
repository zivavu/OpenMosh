/** J and K: the playhead to the previous or next key of what's selected. */

import { chainKeyTimes } from "../effects/param-keys";
import type { EffectInstance } from "../effects/types";
import { laneKeyTimes } from "../media/lane-keys";
import type { MediaLane } from "../media/types";
import { SAME_MOMENT } from "../keyframes";

type KeyedClip = { start: number; end: number; effects: EffectInstance[] };

/** Every moment the clips (inside their span) and layers have a key, in timeline
 * seconds, sorted. */
export function keyMoments(
	clips: KeyedClip[],
	lanes: Pick<MediaLane, "keys" | "keyLinks">[],
): number[] {
	return [
		...clips.flatMap((c) =>
			chainKeyTimes(c.effects)
				.filter((t) => t >= 0 && t <= c.end - c.start + SAME_MOMENT)
				.map((t) => c.start + t),
		),
		...lanes.flatMap(laneKeyTimes),
	].sort((a, b) => a - b);
}

/** The first moment past `at` in `direction`, or null with none that way. */
export function adjacentMoment(
	times: number[],
	at: number,
	direction: -1 | 1,
): number | null {
	const ahead = times.filter((t) =>
		direction > 0 ? t > at + SAME_MOMENT : t < at - SAME_MOMENT,
	);
	if (ahead.length === 0) return null;
	return direction > 0 ? ahead[0] : ahead[ahead.length - 1];
}
