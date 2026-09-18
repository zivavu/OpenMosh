/**
 * One counter every timeline clipboard bumps on copy. The lanes each keep
 * their own clipboard (fx clips, media clips, text clips, and the chain the
 * first two share), and their selections are mutually exclusive — but the
 * clipboards aren't, so after a copy on one lane and then another, a paste
 * with nothing selected would have two of them answer at once. A clipboard
 * pastes only if its copy was the latest: the same "newest wins" rule Ctrl+Z
 * follows across the undo stacks.
 *
 * Plain state, no runes: nothing renders from this.
 */

let stamp = 0;

/** Record a copy; returns the stamp for the clipboard to remember. */
export function markCopied(): number {
	return ++stamp;
}

/** The stamp of the most recent copy anywhere. */
export function latestCopy(): number {
	return stamp;
}
