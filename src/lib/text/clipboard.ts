/** Copy/paste for text clips. A clip is its span, its words, its chain and its
 * position (the rest of the style is the lane's): a whole-clip paste stamps them
 * down in the lane's own look, a paste onto a clip swaps words and chain but keeps
 * its span and position. The same two gestures the media and fx lanes answer to. */

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
	createTextClip,
	type TextClip,
	type TextLane,
	type TextTimeline,
} from "./types";

export interface TextClipboardEntry extends ClipBlockEntry {
	text: string;
	/** The clip's chain and how it rolls, so a paste renders the same. */
	chain: CopiedChain;
	fadeInSec?: number;
	fadeOutSec?: number;
	x?: number;
	y?: number;
}

/** A pasted chain, with fresh instance ids: the renderer keys per-effect
 * state by them and two clips must not share. */
function chainOf(e: TextClipboardEntry): CopiedChain {
	return { ...e.chain, effects: cloneChainEffects(e.chain.effects) };
}

/** Snapshot the given clips, anchored at the earliest one's start. */
export function copyTextClips(
	timeline: TextTimeline,
	clipIds: string[],
): TextClipboardEntry[] {
	return copyClipBlock<TextClip, TextLane, TextClipboardEntry>(
		timeline.lanes,
		clipIds,
		(clip) => ({
			text: clip.text,
			chain: captureChain(clip),
			fadeInSec: clip.fadeInSec,
			fadeOutSec: clip.fadeOutSec,
			x: clip.x,
			y: clip.y,
		}),
	);
}

export interface TextPasteResult {
	timeline: TextTimeline;
	/** The clips that landed, for the caller to select. Empty on a no-op. */
	clipIds: string[];
}

/** Stamp the clipboard down with its earliest clip at `at`; see pasteClipBlock. */
export function pasteTextClips(
	timeline: TextTimeline,
	entries: TextClipboardEntry[],
	at: number,
	duration: number,
	targetLaneId?: string | null,
): TextPasteResult {
	const { lanes, clipIds } = pasteClipBlock(
		timeline.lanes,
		entries,
		at,
		duration,
		targetLaneId,
		(e, start, end) => {
			const clip = applyChainTo(createTextClip(start, end, e.text), chainOf(e));
			if (e.fadeInSec !== undefined) clip.fadeInSec = e.fadeInSec;
			if (e.fadeOutSec !== undefined) clip.fadeOutSec = e.fadeOutSec;
			if (e.x !== undefined) clip.x = e.x;
			if (e.y !== undefined) clip.y = e.y;
			return clip;
		},
	);
	return {
		timeline: lanes === timeline.lanes ? timeline : { ...timeline, lanes },
		clipIds,
	};
}

/** Put the copied words and chain into the selected clips, in time order; a
 * shorter copy repeats over them. Each target keeps its span, fade and lane. */
export function pasteTextOnto(
	timeline: TextTimeline,
	clipIds: string[],
	entries: TextClipboardEntry[],
): TextTimeline {
	const lanes = pasteOntoClips<TextClip, TextLane, TextClipboardEntry>(
		timeline.lanes,
		clipIds,
		entries,
		(c, e) => applyChainTo({ ...c, text: e.text }, chainOf(e)),
	);
	return lanes === timeline.lanes ? timeline : { ...timeline, lanes };
}
