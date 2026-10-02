/** Ctrl+Z / Ctrl+Y across an editor's several undo stacks. Each reports when its
 * top entry was last touched (edit-clock.ts); the newest stamp wins. */

import { asOneEdit, NO_EDIT, PENDING_EDIT } from "./edit-clock";

export interface UndoSource {
	/** Stamp of the edit this source would undo, or NO_EDIT for nothing. */
	readonly undoSeq: number;
	/** Stamp of the edit this source would redo, or NO_EDIT for nothing. */
	readonly redoSeq: number;
	undo: () => void;
	redo: () => void;
}

/** The sources holding the newest stamp: one edit may sit on several stacks. */
function newest(
	sources: (UndoSource | null | undefined)[],
	seqOf: (s: UndoSource) => number,
): UndoSource[] {
	let bestSeq = NO_EDIT;
	for (const s of sources) if (s && seqOf(s) > bestSeq) bestSeq = seqOf(s);
	if (bestSeq === NO_EDIT) return [];
	const all = sources.filter(
		(s): s is UndoSource => !!s && seqOf(s) === bestSeq,
	);
	// An open burst is one stack's alone.
	return bestSeq === PENDING_EDIT ? all.slice(0, 1) : all;
}

/** Undo the newest edit across `sources`. Returns false when there is none. */
export function undoLatest(
	sources: (UndoSource | null | undefined)[],
): boolean {
	const picked = newest(sources, (s) => s.undoSeq);
	if (picked.length === 0) return false;
	asOneEdit(() => picked.forEach((s) => s.undo()));
	return true;
}

/** Redo the most recently undone edit across `sources`. */
export function redoLatest(
	sources: (UndoSource | null | undefined)[],
): boolean {
	const picked = newest(sources, (s) => s.redoSeq);
	if (picked.length === 0) return false;
	asOneEdit(() => picked.forEach((s) => s.redo()));
	return true;
}
