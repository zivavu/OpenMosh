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
import type { MoshSnapshot } from "../editor/mosh-history";
import { beatsToSeconds, type ChainMode } from "../editor/sequence";
import type { Preset } from "../effects";
import { shuffleInPlace } from "../utils";
import { updateMediaClips } from "./resolve";
import type { MediaTimeline } from "./types";

export function setMediaClipsMode(
	timeline: MediaTimeline,
	clipIds: Set<string>,
	mode: ChainMode,
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

/** Re-derive `intervalSec` for every clip whose spacing was set in beats, so
 * correcting the BPM retimes them. Same array back when nothing moves. */
export function applyBpmToMediaClips(
	timeline: MediaTimeline,
	bpm: number,
): MediaTimeline {
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
	return updateMediaClips(timeline, ids, (c) => ({
		...c,
		intervalSec: beatsToSeconds(c.intervalBeats!, bpm),
	}));
}

export function restoreMediaClipMosh(
	timeline: MediaTimeline,
	clipId: string,
	snap: MoshSnapshot,
): MediaTimeline {
	return updateMediaClips(timeline, new Set([clipId]), (clip) =>
		withChainMosh(clip, snap),
	);
}

/**
 * Deal the pool across the given clips, in time order. Dealt from a shuffled
 * deck rather than picked independently: independent picks clump, and four
 * clips in a row on the same media reads as a broken shuffle. Every source is
 * used once before any repeats, and the reshuffle never lets one repeat
 * across the seam either.
 */
export function dealMediaClipSources(
	timeline: MediaTimeline,
	clipIds: Set<string>,
	sourceIds: string[],
): MediaTimeline {
	if (sourceIds.length === 0) return timeline;
	const order = timeline.lanes
		.flatMap((l) => l.clips.map((c) => ({ c, lane: l })))
		.filter(({ c }) => clipIds.has(c.id))
		.sort((a, b) => a.c.start - b.c.start);
	if (order.length === 0) return timeline;
	let deck: string[] = [];
	let last: string | undefined;
	const deal = (): string => {
		if (deck.length === 0) {
			deck = shuffleInPlace([...sourceIds]);
			if (deck.length > 1 && deck[0] === last) {
				[deck[0], deck[1]] = [deck[1], deck[0]];
			}
		}
		last = deck.shift()!;
		return last;
	};
	const dealt = new Map(order.map(({ c }) => [c.id, deal()]));
	return {
		...timeline,
		lanes: timeline.lanes.map((lane) => {
			if (!lane.clips.some((c) => dealt.has(c.id))) return lane;
			return {
				...lane,
				clips: lane.clips.map((c) => {
					const id = dealt.get(c.id);
					if (!id) return c;
					// A clip already on its lane's source keeps no override — see
					// setMediaClipSources.
					return { ...c, sourceId: id === lane.sourceId ? undefined : id };
				}),
			};
		}),
	};
}
