/** One clock for every undo stack, so Ctrl+Z steps back through what the user did,
 * not the current selection's stack. The router (undo-router.ts) picks the newest. */

let tick = 0;
/** Set while one edit lands on several stacks, so they all take this stamp. */
let shared: number | null = null;

export function nextEditSeq(): number {
	return shared ?? ++tick;
}

/** Run `fn` as one edit: every stack it pushes to is stamped alike, so Ctrl+Z and
 * Ctrl+Y take it back across all of them at once. */
export function asOneEdit<T>(fn: () => T): T {
	if (shared !== null) return fn();
	shared = ++tick;
	try {
		return fn();
	} finally {
		shared = null;
	}
}

/** Below every real stamp: a stack with nothing to undo never wins. */
export const NO_EDIT = -1;

/** Above every real stamp, for an edit still open (a panel burst inside its
 * coalescing window) and so not yet on its stack. */
export const PENDING_EDIT = Number.MAX_SAFE_INTEGER;
