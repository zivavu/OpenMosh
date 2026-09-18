/**
 * The editor used to have a segment lane: a gapless partition of the song,
 * each span with its own chain and, optionally, a pool source to draw. Media
 * layers and fx lanes do both jobs now, so a saved entry's segments are folded
 * into those on load — once, and then saved back without them.
 *
 * The chains become one fx lane of clips, span for span, so they keep rolling
 * over the frame as they did. Segments that named a source become clips on a
 * media layer under the effects, so what each span showed still shows.
 * Transitions have no counterpart and are dropped.
 */

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

/** True when a chain switches anything on — an all-off span adds nothing. */
function contributes(seg: LegacySegment, effects: EffectInstance[]): boolean {
	return seg.mode === "interval" || effects.some((e) => e.enabled);
}

/**
 * Fold saved segments into an fx lane and a media lane. Both sit at the foot
 * of the stack — the media lane under everything, the fx lane just over it —
 * which is where the segment lane rendered.
 */
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
	for (const { seg, start, end } of spans) {
		if (!seg.sourceId) continue;
		mediaLane.clips.push(createMediaClip(start, end, 0, seg.sourceId));
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
