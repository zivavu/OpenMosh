/**
 * Whole-clip copy/paste for the fx lanes: span, chain and fade together, to
 * be stamped down elsewhere on the timeline. The chain alone travels through
 * chainClipboard, which is what a paste *onto* a clip uses; this is the paste
 * that makes new clips.
 *
 * Clips land on the lane last clicked, or back where they came from. A
 * static clip's chain is concrete and goes anywhere; an interval clip re-rolls
 * under whichever lane's settings it lands on, which is what a lane's settings
 * are for.
 */

import { cloneEffectInstance } from "../effects";
import {
	placeClipBlock,
	retargetClipBlock,
	sortClips,
	type ClipBlockEntry,
} from "../timeline/clips";
import {
	applyChainTo,
	captureChain,
	type CopiedChain,
} from "./chain-clipboard";
import { createFxClip, type FxClip, type FxLane } from "./fx-lanes";

export interface FxClipboardEntry extends ClipBlockEntry {
	chain: CopiedChain;
	fadeSec?: number;
}

/** Snapshot the given clips, anchored at the earliest one's start. */
export function copyFxClips(
	lanes: FxLane[],
	clipIds: string[],
): FxClipboardEntry[] {
	const ids = new Set(clipIds);
	const found: FxClipboardEntry[] = [];
	let anchor = Infinity;
	for (const lane of lanes) {
		for (const clip of lane.clips) {
			if (!ids.has(clip.id)) continue;
			anchor = Math.min(anchor, clip.start);
			found.push({
				laneId: lane.id,
				offset: clip.start,
				length: clip.end - clip.start,
				chain: captureChain(clip),
				fadeSec: clip.fadeSec,
			});
		}
	}
	return found
		.map((e) => ({ ...e, offset: e.offset - anchor }))
		.sort((a, b) => a.offset - b.offset);
}

export interface FxPasteResult {
	lanes: FxLane[];
	/** The clips that landed, for the caller to select. Empty on a no-op. */
	clipIds: string[];
}

/**
 * Stamp the clipboard down with its earliest clip at `at`, on `targetLaneId`
 * when that is an fx lane (the block's other lanes follow below it) and
 * otherwise back where it was copied from. See placeClipBlock for where the
 * copies land when the space is short. Fresh clip ids and effect instance ids
 * each paste, so two copies never share feedback state.
 */
export function pasteFxClips(
	lanes: FxLane[],
	entries: FxClipboardEntry[],
	at: number,
	duration: number,
	targetLaneId?: string | null,
): FxPasteResult {
	const unchanged: FxPasteResult = { lanes, clipIds: [] };
	if (entries.length === 0 || duration <= 0) return unchanged;
	const byId = new Map<string, FxLane>(lanes.map((l) => [l.id, l]));
	const moved = retargetClipBlock(
		entries,
		lanes.map((l) => l.id),
		targetLaneId,
	);
	const placed = placeClipBlock(moved, byId, at, duration);
	if (placed.length === 0) return unchanged;

	const added = new Map<string, FxClip[]>();
	const clipIds: string[] = [];
	for (const { entry: e, start, end } of placed) {
		const clip = applyChainTo(createFxClip(start, end), {
			...e.chain,
			effects: e.chain.effects.map(cloneEffectInstance),
		});
		if (e.fadeSec !== undefined) clip.fadeSec = e.fadeSec;
		clipIds.push(clip.id);
		const list = added.get(e.laneId);
		if (list) list.push(clip);
		else added.set(e.laneId, [clip]);
	}
	return {
		lanes: lanes.map((lane) => {
			const list = added.get(lane.id);
			return list
				? { ...lane, clips: sortClips([...lane.clips, ...list]) }
				: lane;
		}),
		clipIds,
	};
}
