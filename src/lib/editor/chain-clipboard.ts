/** One clipboard for effect chains, shared by every lane whose clips carry one. */

import { cloneEffectInstance } from "../effects";
import type { ChainClip } from "./chain-clip";
import { markCopied } from "./copy-stamp";

/** The chain and how it rolls: a clip minus its span. */
export type CopiedChain = Omit<ChainClip, "id" | "start" | "end">;

/** The chain and its rolling, cloned so the copy outlives the source. */
export function captureChain(src: ChainClip): CopiedChain {
	return {
		label: src.label,
		mode: src.mode,
		presetName: src.presetName,
		modified: src.modified,
		// Cloned on the way in as well as out, so the copy survives the source being edited.
		effects: src.effects.map(cloneEffectInstance),
		intervalSec: src.intervalSec,
		intervalBeats: src.intervalBeats,
		seed: src.seed,
	};
}

class ChainClipboard {
	clips: CopiedChain[] = [];

	/** The copy stamp (see copy-stamp.ts) of the last fill. */
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

/** Overwrite what a clip does, keeping what it *is*: its id, its span. */
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
