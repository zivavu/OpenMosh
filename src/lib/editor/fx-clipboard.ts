/**
 * Whole-clip copy/paste for the fx lanes: span, chain and fade together, to
 * be stamped down elsewhere on the timeline. The chain alone travels through
 * chainClipboard, which is what a paste *onto* a clip uses; this is the paste
 * that makes new clips.
 *
 * Clips land back on the lane they came from, the same way media clips do:
 * a lane rolls its moshes under its own settings, and a clip's chain was
 * rolled under the lane it sat on.
 */

import { cloneEffectInstance } from "../effects";
import {
	firstFreeDelta,
	sortClips,
	type ClipBlockEntry,
} from "../timeline/clips";
import {
	applyChainToFxClip,
	captureChain,
	type ChainClip,
} from "./chain-clipboard";
import { createFxClip, type FxClip, type FxLane } from "./fx-lanes";

export interface FxClipboardEntry extends ClipBlockEntry {
	chain: ChainClip;
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
 * Stamp the clipboard down with its earliest clip at `at`, slid right to the
 * first place the whole block fits (see firstFreeDelta). Fresh clip ids and
 * effect instance ids each paste, so two copies never share feedback state.
 */
export function pasteFxClips(
	lanes: FxLane[],
	entries: FxClipboardEntry[],
	at: number,
	duration: number,
): FxPasteResult {
	const unchanged: FxPasteResult = { lanes, clipIds: [] };
	if (entries.length === 0 || duration <= 0) return unchanged;
	const byId = new Map<string, FxLane>(lanes.map((l) => [l.id, l]));
	const delta = firstFreeDelta(entries, byId, Math.max(0, at), duration);
	if (delta === null) return unchanged;

	const added = new Map<string, FxClip[]>();
	const clipIds: string[] = [];
	for (const e of entries) {
		if (!byId.has(e.laneId)) continue;
		const start = Math.max(0, at) + e.offset + delta;
		const clip = applyChainToFxClip(createFxClip(start, start + e.length), {
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
