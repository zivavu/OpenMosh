/** One counter every timeline clipboard bumps on copy. Clipboards aren't mutually
 * exclusive, so a paste only fires if its copy was the latest ("newest wins"). */

let stamp = 0;

/** Record a copy; returns the stamp for the clipboard to remember. */
export function markCopied(): number {
	return ++stamp;
}

export function latestCopy(): number {
	return stamp;
}
