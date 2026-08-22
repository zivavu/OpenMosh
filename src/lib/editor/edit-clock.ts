/**
 * One clock for every undo stack in an editor.
 *
 * An editor keeps several stacks — the effect chain, the text timeline, the fx
 * lanes, the segment boundaries, the audio span — because the things they hold
 * are different shapes. Ctrl+Z, though, is one key: it has to step back through
 * what the user actually did, not through whichever stack the current selection
 * happens to point at. Every stack stamps each entry with a tick from here, and
 * the router (see undo-router.ts) undoes whichever stack holds the newest one.
 *
 * The stamp moves with the entry: undoing re-stamps it as the newest thing to
 * redo, redoing re-stamps it as the newest thing to undo. So a tick always
 * means "when this state last crossed the cursor", which is what makes
 * interleaved undo across stacks come back in the order it went in.
 */

let tick = 0;

export function nextEditSeq(): number {
   return ++tick;
}

/** Below every real stamp: a stack with nothing to undo never wins. */
export const NO_EDIT = -1;

/** Above every real stamp — for an edit that is still open (a panel burst
 * inside its coalescing window) and so not yet on its stack. */
export const PENDING_EDIT = Number.MAX_SAFE_INTEGER;
