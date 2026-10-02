import type { EffectInstance } from "../../effects/types";
import type { FeedbackKind } from "../../feedback/submit";

export interface FeedbackPrefill {
	kind?: FeedbackKind;
	message?: string;
	/** The chain to report in place of the live one: a crash has torn the editor down. */
	chain?: EffectInstance[] | null;
}

/** The feedback modal is mounted once at the app root; every view opens it
 * through here rather than owning its own copy. */
let open = $state(false);
/** Read by the modal as it opens; reactive, so an open while it's up still lands. */
let prefill = $state.raw<FeedbackPrefill | null>(null);

/** Set by whichever editor is mounted, so a report can carry the chain that
 * was on screen. Null on the upload screen, where there isn't one. */
let chainSource: (() => EffectInstance[]) | null = null;

export function isFeedbackOpen() {
	return open;
}

export function openFeedback(start?: FeedbackPrefill) {
	prefill = start ?? null;
	open = true;
}

/** What the modal starts from. */
export function feedbackPrefill(): FeedbackPrefill | null {
	return prefill;
}

export function closeFeedback() {
	open = false;
}

/** The chain an editor held as it went away, and when; a crash unmounts it first. */
let lastChain: { effects: EffectInstance[]; at: number } | null = null;

/** Register the live effect chain for feedback reports; pass null to clear. */
export function setFeedbackChain(source: (() => EffectInstance[]) | null) {
	if (!source && chainSource) {
		try {
			lastChain = { effects: chainSource(), at: performance.now() };
		} catch {
			lastChain = null;
		}
	}
	chainSource = source;
}

/** The chain of an editor that closed within `withinMs`, for the crash screen. */
export function recentlyClosedChain(withinMs = 2000): EffectInstance[] | null {
	if (!lastChain || performance.now() - lastChain.at > withinMs) return null;
	return lastChain.effects;
}

export function getFeedbackChain(): EffectInstance[] | null {
	return chainSource?.() ?? null;
}
