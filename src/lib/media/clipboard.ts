/** Copy/paste for media layer clips. A clip carries its span, in-point, source
 * and chain; the placement lives on the lane, so a whole-clip paste brings the
 * clip and not that. Pasting onto a clip keeps its span, fade and lane. */

import {
	applyChainTo,
	captureChain,
	type CopiedChain,
} from "../editor/chain-clipboard";
import { cloneChainEffects } from "../editor/chain-clip";
import {
	copyClipBlock,
	pasteClipBlock,
	pasteOntoClips,
} from "../timeline/clip-clipboard";
import type { ClipBlockEntry } from "../timeline/clips";
import {
	createMediaClip,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
} from "./types";

/** One copied clip, placed relative to the earliest one in the copy. */
export interface MediaClipboardEntry extends ClipBlockEntry {
	sourceStart: number;
	/** The clip's own source, when it had one; absent means the lane's. */
	sourceId?: string;
	/** What the clip showed, resolved through its lane at copy time, so a paste onto
	 * a clip elsewhere shows the same picture. Null for a lane with no source yet. */
	resolvedSourceId: string | null;
	/** The clip's chain and how it rolls, so a paste renders the same. */
	chain: CopiedChain;
	fadeInSec?: number;
	fadeOutSec?: number;
}

/** A pasted chain, with fresh instance ids: the renderer keys per-effect state by them. */
function chainOf(e: MediaClipboardEntry): CopiedChain {
	return { ...e.chain, effects: cloneChainEffects(e.chain.effects) };
}

/** The source a copy shows on `lane`: pinned on the clip unless it is already what
 * the lane shows, so the lane's picker keeps meaning "this lane's default". */
function pinnedSource(
	e: MediaClipboardEntry,
	lane: MediaLane,
): string | undefined {
	const resolved = e.resolvedSourceId ?? undefined;
	return resolved === lane.sourceId ? undefined : resolved;
}

/** Snapshot the given clips, anchored at the earliest one's start. */
export function copyMediaClips(
	timeline: MediaTimeline,
	clipIds: string[],
): MediaClipboardEntry[] {
	return copyClipBlock<MediaClip, MediaLane, MediaClipboardEntry>(
		timeline.lanes,
		clipIds,
		(clip, lane) => ({
			sourceStart: clip.sourceStart,
			sourceId: clip.sourceId,
			resolvedSourceId: clip.sourceId ?? lane.sourceId,
			chain: captureChain(clip),
			fadeInSec: clip.fadeInSec,
			fadeOutSec: clip.fadeOutSec,
		}),
	);
}

export interface MediaPasteResult {
	timeline: MediaTimeline;
	/** The clips that landed, for the caller to select. Empty on a no-op. */
	clipIds: string[];
}

/** Stamp the clipboard down with its earliest clip at `at` — see pasteClipBlock.
 * A copy landing on another lane keeps showing what it showed: its source is pinned
 * unless it is already what the new lane shows. */
export function pasteMediaClips(
	timeline: MediaTimeline,
	entries: MediaClipboardEntry[],
	at: number,
	duration: number,
	targetLaneId?: string | null,
): MediaPasteResult {
	const { lanes, clipIds } = pasteClipBlock(
		timeline.lanes,
		entries,
		at,
		duration,
		targetLaneId,
		(e, start, end, lane, retargeted) => {
			const sourceId = retargeted ? pinnedSource(e, lane) : e.sourceId;
			const clip = applyChainTo(
				createMediaClip(start, end, e.sourceStart, sourceId),
				chainOf(e),
			);
			if (e.fadeInSec !== undefined) clip.fadeInSec = e.fadeInSec;
			if (e.fadeOutSec !== undefined) clip.fadeOutSec = e.fadeOutSec;
			return clip;
		},
	);
	return {
		timeline: lanes === timeline.lanes ? timeline : { ...timeline, lanes },
		clipIds,
	};
}

/** Put what the copied clips showed into the selected clips, in time order; a
 * shorter copy repeats. Each target keeps its span, fade and lane. */
export function pasteMediaContentOnto(
	timeline: MediaTimeline,
	clipIds: string[],
	entries: MediaClipboardEntry[],
): MediaTimeline {
	const lanes = pasteOntoClips<MediaClip, MediaLane, MediaClipboardEntry>(
		timeline.lanes,
		clipIds,
		entries,
		(c, e, lane) =>
			applyChainTo(
				{ ...c, sourceStart: e.sourceStart, sourceId: pinnedSource(e, lane) },
				chainOf(e),
			),
	);
	return lanes === timeline.lanes ? timeline : { ...timeline, lanes };
}
