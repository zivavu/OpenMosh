/** One clock for every undo stack, so Ctrl+Z steps back through what the user did,
 * not the current selection's stack. The router (undo-router.ts) picks the newest. */

let tick = 0;

export function nextEditSeq(): number {
	return ++tick;
}

/** Below every real stamp: a stack with nothing to undo never wins. */
export const NO_EDIT = -1;

/** Above every real stamp, for an edit still open (a panel burst inside its
 * coalescing window) and so not yet on its stack. */
export const PENDING_EDIT = Number.MAX_SAFE_INTEGER;
