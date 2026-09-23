/** The old segment lane is folded on load into one fx lane of clips (chains, span
 * for span) and a media layer under the effects (sources and transitions). */

import { restoreEffects, type EffectInstance } from "../effects";
import { normalizeChainFields } from "./chain-clip";
import type { ChainMode } from "./sequence";
import { createFxClip, createFxLane, type FxLane } from "./fx-lanes";
import {
	createMediaClip,
	createMediaLane,
	type MediaLane,
	type MediaTimeline,
} from "../media";
import { MIN_CLIP_LENGTH } from "../timeline/clips";
import { LEGACY_LANE_AUDIO } from "../mix/types";
import { normalizeClipTransition } from "../media/transition";

/** What a saved segment looked like; anything else it carried is ignored. */
interface LegacySegment {
	startTime?: number;
	endTime?: number | null;
	sourceId?: string;
	effects?: unknown;
	label?: string;
	mode?: ChainMode;
	presetName?: string;
	modified?: boolean;
	intervalSec?: number;
	intervalBeats?: number;
	seed?: number;
	transition?: unknown;
}

/** Below any z a lane gets by hand: those count up from zero. */
const BOTTOM_Z = -1000;

export interface MigratedSegments {
	fxLane: FxLane | null;
	mediaLane: MediaLane | null;
}

/** Sorted spans with an explicit end, dropping anything too short to hold. */
function spansOf(
	raw: unknown,
	duration: number,
): { seg: LegacySegment; start: number; end: number }[] {
	if (!Array.isArray(raw)) return [];
	const segs = (raw as LegacySegment[])
		.filter((s) => typeof s?.startTime === "number")
		.sort((a, b) => a.startTime! - b.startTime!);
	const out: { seg: LegacySegment; start: number; end: number }[] = [];
	for (let i = 0; i < segs.length; i++) {
		const seg = segs[i];
		const start = Math.max(0, seg.startTime!);
		const end = Math.min(
			duration,
			seg.endTime ?? segs[i + 1]?.startTime ?? duration,
		);
		if (end - start >= MIN_CLIP_LENGTH) out.push({ seg, start, end });
	}
	return out;
}

/** True when a chain switches anything on, an all-off span adds nothing. */
function contributes(seg: LegacySegment, effects: EffectInstance[]): boolean {
	return seg.mode === "interval" || effects.some((e) => e.enabled);
}

/** Fold saved segments into an fx lane and a media lane, both at the foot of the
 * stack (media under everything, fx just over it) where the segment lane rendered. */
export function migrateLegacySegments(
	raw: unknown,
	duration: number,
): MigratedSegments {
	const spans = spansOf(raw, duration);
	if (spans.length === 0) return { fxLane: null, mediaLane: null };

	const fxLane = createFxLane("Segments", undefined, BOTTOM_Z + 1);
	for (const { seg, start, end } of spans) {
		const effects = restoreEffects(seg.effects);
		if (!contributes(seg, effects)) continue;
		const { effects: _, ...chain } = seg;
		fxLane.clips.push({
			...createFxClip(start, end),
			...normalizeChainFields(chain, effects),
		});
	}

	const mediaLane = createMediaLane("Base", null, BOTTOM_Z);
	mediaLane.underEffects = true;
	// Segments were always silent under the song; migrating mustn't give them a voice.
	mediaLane.audio = { ...LEGACY_LANE_AUDIO };
	for (const { seg, start, end } of spans) {
		if (!seg.sourceId) continue;
		const clip = createMediaClip(start, end, 0, seg.sourceId);
		const transition = normalizeClipTransition(seg.transition);
		if (transition) clip.transition = transition;
		mediaLane.clips.push(clip);
	}

	return {
		fxLane: fxLane.clips.length > 0 ? fxLane : null,
		mediaLane: mediaLane.clips.length > 0 ? mediaLane : null,
	};
}

/** Where the migrated media lane goes: first, under whatever is there. */
export function prependMediaLane(
	timeline: MediaTimeline,
	lane: MediaLane,
): MediaTimeline {
	return { ...timeline, lanes: [lane, ...timeline.lanes] };
}
