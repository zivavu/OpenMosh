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
	copyClipBlock,
	pasteClipBlock,
	type ClipBlockPaste,
} from "../timeline/clip-clipboard";
import type { ClipBlockEntry } from "../timeline/clips";
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
	return copyClipBlock<FxClip, FxLane, FxClipboardEntry>(
		lanes,
		clipIds,
		(clip) => ({ chain: captureChain(clip), fadeSec: clip.fadeSec }),
	);
}

export type FxPasteResult = ClipBlockPaste<FxLane>;

/**
 * Stamp the clipboard down with its earliest clip at `at` — see
 * pasteClipBlock. Fresh clip ids and effect instance ids each paste, so two
 * copies never share feedback state.
 */
export function pasteFxClips(
	lanes: FxLane[],
	entries: FxClipboardEntry[],
	at: number,
	duration: number,
	targetLaneId?: string | null,
): FxPasteResult {
	return pasteClipBlock(
		lanes,
		entries,
		at,
		duration,
		targetLaneId,
		(e, start, end) => {
			const clip = applyChainTo(createFxClip(start, end), {
				...e.chain,
				effects: e.chain.effects.map(cloneEffectInstance),
			});
			if (e.fadeSec !== undefined) clip.fadeSec = e.fadeSec;
			return clip;
		},
	);
}
