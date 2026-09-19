/**
 * The chain gestures on text clips — fill, mosh, clear, static/auto — as the
 * clip toolbar and the ←/→ arrows drive them. Thin fan-outs over the shared
 * chain-clip rules, so a text clip rolls exactly as a media or fx clip does.
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
import type { MoshSnapshot } from "../editor/mosh-history";
import { beatsToSeconds, type ChainMode } from "../editor/sequence";
import type { Preset } from "../effects";
import { updateTextClips } from "./resolve";
import type { TextTimeline } from "./types";

export function setTextClipsMode(
	timeline: TextTimeline,
	clipIds: Set<string>,
	mode: ChainMode,
	intervalSec?: number,
	intervalBeats?: number | null,
): TextTimeline {
	return updateTextClips(timeline, clipIds, (clip) =>
		withChainMode(clip, mode, intervalSec, intervalBeats),
	);
}

export function rollTextClips(
	timeline: TextTimeline,
	clipIds: Set<string>,
	options: MoshOptions,
): TextTimeline {
	return updateTextClips(timeline, clipIds, (clip) =>
		rolledChainClip(clip, options),
	);
}

export function clearTextClips(
	timeline: TextTimeline,
	clipIds: Set<string>,
): TextTimeline {
	return updateTextClips(timeline, clipIds, clearedChainClip);
}

export function fillTextClipsFromPreset(
	timeline: TextTimeline,
	clipIds: Set<string>,
	preset: Preset,
): TextTimeline {
	return updateTextClips(timeline, clipIds, (clip) =>
		filledChainClip(clip, preset),
	);
}

/** A preset was overwritten: refresh every unmodified clip filled from it. */
export function syncTextClipsToPreset(
	timeline: TextTimeline,
	preset: Preset,
): TextTimeline {
	const ids = new Set(
		timeline.lanes.flatMap((l) =>
			l.clips.filter((c) => c.presetName === preset.name).map((c) => c.id),
		),
	);
	return updateTextClips(timeline, ids, (clip) =>
		syncedChainClip(clip, preset),
	);
}

/** Re-derive `intervalSec` for every clip whose spacing was set in beats, so
 * correcting the BPM retimes them. Same timeline back when nothing moves. */
export function applyBpmToTextClips(
	timeline: TextTimeline,
	bpm: number,
): TextTimeline {
	if (bpm <= 0) return timeline;
	const ids = new Set(
		timeline.lanes.flatMap((l) =>
			l.clips
				.filter(
					(c) =>
						c.intervalBeats &&
						Math.abs(
							(c.intervalSec ?? 0) - beatsToSeconds(c.intervalBeats, bpm),
						) >= 0.0005,
				)
				.map((c) => c.id),
		),
	);
	return updateTextClips(timeline, ids, (c) => ({
		...c,
		intervalSec: beatsToSeconds(c.intervalBeats!, bpm),
	}));
}

export function restoreTextClipMosh(
	timeline: TextTimeline,
	clipId: string,
	snap: MoshSnapshot,
): TextTimeline {
	return updateTextClips(timeline, new Set([clipId]), (clip) =>
		withChainMosh(clip, snap),
	);
}
