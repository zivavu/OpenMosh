/**
 * The chain gestures on media clips — fill, mosh, clear, static/auto — as the
 * clip toolbar and the ←/→ arrows drive them. Thin fan-outs over the shared
 * chain-clip rules, so a media clip rolls exactly as an fx clip does.
 */

import {
	clearedChainClip,
	filledChainClip,
	rolledChainClip,
	syncedChainClip,
	withChainMode,
	withChainMosh,
} from "../editor/chain-clip";
import type { MoshOptions } from "../editor/mosh";
import type { SegmentMoshSnapshot } from "../editor/segment-mosh-history";
import type { SequenceSegmentMode } from "../editor/sequence";
import type { Preset } from "../effects";
import { updateMediaClips } from "./resolve";
import type { MediaTimeline } from "./types";

export function setMediaClipsMode(
	timeline: MediaTimeline,
	clipIds: Set<string>,
	mode: SequenceSegmentMode,
	intervalSec?: number,
	intervalBeats?: number | null,
): MediaTimeline {
	return updateMediaClips(timeline, clipIds, (clip) =>
		withChainMode(clip, mode, intervalSec, intervalBeats),
	);
}

export function rollMediaClips(
	timeline: MediaTimeline,
	clipIds: Set<string>,
	options: MoshOptions,
): MediaTimeline {
	return updateMediaClips(timeline, clipIds, (clip) =>
		rolledChainClip(clip, options),
	);
}

export function clearMediaClips(
	timeline: MediaTimeline,
	clipIds: Set<string>,
): MediaTimeline {
	return updateMediaClips(timeline, clipIds, clearedChainClip);
}

export function fillMediaClipsFromPreset(
	timeline: MediaTimeline,
	clipIds: Set<string>,
	preset: Preset,
): MediaTimeline {
	return updateMediaClips(timeline, clipIds, (clip) =>
		filledChainClip(clip, preset),
	);
}

/** A preset was overwritten: refresh every unmodified clip filled from it. */
export function syncMediaClipsToPreset(
	timeline: MediaTimeline,
	preset: Preset,
): MediaTimeline {
	const ids = new Set(
		timeline.lanes.flatMap((l) =>
			l.clips.filter((c) => c.presetName === preset.name).map((c) => c.id),
		),
	);
	return updateMediaClips(timeline, ids, (clip) =>
		syncedChainClip(clip, preset),
	);
}

export function restoreMediaClipMosh(
	timeline: MediaTimeline,
	clipId: string,
	snap: SegmentMoshSnapshot,
): MediaTimeline {
	return updateMediaClips(timeline, new Set([clipId]), (clip) =>
		withChainMosh(clip, snap),
	);
}
