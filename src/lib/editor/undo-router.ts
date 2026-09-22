/** Ctrl+Z / Ctrl+Y across an editor's several undo stacks. Each reports when its
 * top entry was last touched (edit-clock.ts); the newest stamp wins. */

import { NO_EDIT } from "./edit-clock";

export interface UndoSource {
	/** Stamp of the edit this source would undo, or NO_EDIT for nothing. */
	readonly undoSeq: number;
	/** Stamp of the edit this source would redo, or NO_EDIT for nothing. */
	readonly redoSeq: number;
	undo: () => void;
	redo: () => void;
}

/** Undo the newest edit across `sources`. Returns false when there is none. */
export function undoLatest(
	sources: (UndoSource | null | undefined)[],
): boolean {
	let best: UndoSource | null = null;
	let bestSeq = NO_EDIT;
	for (const source of sources) {
		if (source && source.undoSeq > bestSeq) {
			best = source;
			bestSeq = source.undoSeq;
		}
	}
	if (!best) return false;
	best.undo();
	return true;
}

/** Redo the most recently undone edit across `sources`. */
export function redoLatest(
	sources: (UndoSource | null | undefined)[],
): boolean {
	let best: UndoSource | null = null;
	let bestSeq = NO_EDIT;
	for (const source of sources) {
		if (source && source.redoSeq > bestSeq) {
			best = source;
			bestSeq = source.redoSeq;
		}
	}
	if (!best) return false;
	best.redo();
	return true;
}
