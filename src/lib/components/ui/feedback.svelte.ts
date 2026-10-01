import type { EffectInstance } from "../../effects/types";
import type { FeedbackKind } from "../../feedback/submit";

export interface FeedbackPrefill {
	kind?: FeedbackKind;
	message?: string;
}

/** The feedback modal is mounted once at the app root; every view opens it
 * through here rather than owning its own copy. */
let open = $state(false);
let prefill: FeedbackPrefill | null = null;

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

/** What the modal starts from, handed over once. */
export function takeFeedbackPrefill(): FeedbackPrefill | null {
	const taken = prefill;
	prefill = null;
	return taken;
}

export function closeFeedback() {
	open = false;
}

/** Register the live effect chain for feedback reports; pass null to clear. */
export function setFeedbackChain(source: (() => EffectInstance[]) | null) {
	chainSource = source;
}

export function getFeedbackChain(): EffectInstance[] | null {
	return chainSource?.() ?? null;
}
