/**
 * One clipboard for effect chains, shared by every lane whose clips carry one
 * (see chain-clip.ts): "copy these effects onto that" means the same thing on
 * an fx clip and a media clip, so this carries the behaviour they share and
 * nothing else. Pasting never moves a clip's media, its fade or its span,
 * because none of that is an effect.
 *
 * Module-level rather than a prop: the timelines are siblings with mutually
 * exclusive selections (see keepOnlySelection), so a copy in one is always
 * followed by a paste in the other with no common parent state in between.
 *
 * Plain state, no runes: nothing renders from this. The timelines read it from
 * a keydown handler, which is not a reactive context.
 */

import { cloneEffectInstance } from "../effects";
import type { ChainClip } from "./chain-clip";
import { markCopied } from "./copy-stamp";

/** The chain and how it rolls — a clip minus its span. */
export type CopiedChain = Omit<ChainClip, "id" | "start" | "end">;

/** The chain and its rolling, cloned so the copy outlives the source. */
export function captureChain(src: ChainClip): CopiedChain {
	return {
		label: src.label,
		mode: src.mode,
		presetName: src.presetName,
		modified: src.modified,
		// Cloned on the way in as well as out: the copy has to survive the source
		// being edited or deleted before it is pasted.
		effects: src.effects.map(cloneEffectInstance),
		intervalSec: src.intervalSec,
		intervalBeats: src.intervalBeats,
		seed: src.seed,
	};
}

class ChainClipboard {
	clips: CopiedChain[] = [];

	/** The copy stamp (see copy-stamp.ts) of the last fill. The timelines keep
	 * richer clipboards of their own, filled by the same Ctrl+C, so a paste
	 * has to know which was filled last. */
	stamp = 0;

	/** Snapshot chains in the order given; the caller sorts by time. */
	copy(items: ChainClip[]) {
		if (items.length === 0) return false;
		this.clips = items.map(captureChain);
		this.stamp = markCopied();
		return true;
	}

	/** Fresh instance ids each paste, so two pasted copies never share state. */
	at(i: number): CopiedChain | null {
		const clip = this.clips[i % this.clips.length];
		if (!clip) return null;
		return { ...clip, effects: clip.effects.map(cloneEffectInstance) };
	}
}

export const chainClipboard = new ChainClipboard();

/** Overwrite what a clip does, keeping what it *is*: its id, its span and
 * whatever else its lane kind hangs on it. */
export function applyChainTo<C extends ChainClip>(
	clip: C,
	chain: CopiedChain,
): C {
	return {
		...clip,
		label: chain.label,
		mode: chain.mode ?? "static",
		presetName: chain.presetName,
		modified: chain.modified,
		effects: chain.effects,
		intervalSec: chain.intervalSec,
		intervalBeats: chain.intervalBeats,
		seed: chain.seed,
	};
}
