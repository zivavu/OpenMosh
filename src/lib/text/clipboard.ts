/**
 * Copy/paste for text clips. A clip is its span, its words and its chain —
 * the style is the lane's — so a whole-clip paste stamps the words and chain
 * down elsewhere in the lane's own look, and a paste *onto* a clip swaps its
 * words and chain and keeps its span. The same two gestures the media and fx
 * lanes answer to.
 */

import {
	applyChainTo,
	captureChain,
	type CopiedChain,
} from "../editor/chain-clipboard";
import { cloneChainEffects } from "../editor/chain-clip";
import {
	placeClipBlock,
	retargetClipBlock,
	sortClips,
	type ClipBlockEntry,
} from "../timeline/clips";
import { createTextClip, type TextClip, type TextTimeline } from "./types";

export interface TextClipboardEntry extends ClipBlockEntry {
	text: string;
	/** The clip's chain and how it rolls, so a paste renders the same. */
	chain: CopiedChain;
	fadeInSec?: number;
	fadeOutSec?: number;
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
	const ids = new Set(clipIds);
	const found: TextClipboardEntry[] = [];
	let anchor = Infinity;
	for (const lane of timeline.lanes) {
		for (const clip of lane.clips) {
			if (!ids.has(clip.id)) continue;
			anchor = Math.min(anchor, clip.start);
			found.push({
				laneId: lane.id,
				offset: clip.start,
				length: clip.end - clip.start,
				text: clip.text,
				chain: captureChain(clip),
				fadeInSec: clip.fadeInSec,
				fadeOutSec: clip.fadeOutSec,
			});
		}
	}
	return found
		.map((e) => ({ ...e, offset: e.offset - anchor }))
		.sort((a, b) => a.offset - b.offset);
}

export interface TextPasteResult {
	timeline: TextTimeline;
	/** The clips that landed, for the caller to select. Empty on a no-op. */
	clipIds: string[];
}

/**
 * Stamp the clipboard down with its earliest clip at `at`, on `targetLaneId`
 * when that is a text lane (the block's other lanes follow below it) and
 * otherwise back where it was copied from. See placeClipBlock for where the
 * copies land when the space is short.
 */
export function pasteTextClips(
	timeline: TextTimeline,
	entries: TextClipboardEntry[],
	at: number,
	duration: number,
	targetLaneId?: string | null,
): TextPasteResult {
	const unchanged: TextPasteResult = { timeline, clipIds: [] };
	if (entries.length === 0 || duration <= 0) return unchanged;
	const byId = new Map(timeline.lanes.map((l) => [l.id, l]));
	const moved = retargetClipBlock(
		entries,
		timeline.lanes.map((l) => l.id),
		targetLaneId,
	);
	const placed = placeClipBlock(moved, byId, at, duration);
	if (placed.length === 0) return unchanged;

	const added = new Map<string, TextClip[]>();
	const clipIds: string[] = [];
	for (const { entry: e, start, end } of placed) {
		const clip = applyChainTo(createTextClip(start, end, e.text), chainOf(e));
		if (e.fadeInSec !== undefined) clip.fadeInSec = e.fadeInSec;
		if (e.fadeOutSec !== undefined) clip.fadeOutSec = e.fadeOutSec;
		clipIds.push(clip.id);
		const list = added.get(e.laneId);
		if (list) list.push(clip);
		else added.set(e.laneId, [clip]);
	}
	return {
		timeline: {
			...timeline,
			lanes: timeline.lanes.map((lane) => {
				const list = added.get(lane.id);
				return list
					? { ...lane, clips: sortClips([...lane.clips, ...list]) }
					: lane;
			}),
		},
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
	if (entries.length === 0 || clipIds.length === 0) return timeline;
	const targets = new Set(clipIds);
	const order = timeline.lanes
		.flatMap((l) => l.clips)
		.filter((c) => targets.has(c.id))
		.sort((a, b) => a.start - b.start)
		.map((c) => c.id);
	if (order.length === 0) return timeline;
	return {
		...timeline,
		lanes: timeline.lanes.map((lane) => {
			if (!lane.clips.some((c) => targets.has(c.id))) return lane;
			return {
				...lane,
				clips: lane.clips.map((c) => {
					const i = order.indexOf(c.id);
					if (i === -1) return c;
					const e = entries[i % entries.length];
					return applyChainTo({ ...c, text: e.text }, chainOf(e));
				}),
			};
		}),
	};
}
