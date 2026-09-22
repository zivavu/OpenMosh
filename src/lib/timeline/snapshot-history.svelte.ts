/** Snapshot undo stack for a whole timeline document. Callers push the state they
 * are about to replace, immediately before changing it, and hand the live state to
 * `undo`/`redo`; the live state is never in the stack, so the state before a
 * coalesced gesture's first tick is recorded. `coalesceKey` merges the ticks of one
 * gesture into a single entry, lapsing after a pause. */

import { NO_EDIT, PENDING_EDIT, nextEditSeq } from "../editor/edit-clock";
import type { UndoSource } from "../editor/undo-router";

/** How long a coalesce key stays live. Longer than the gap between drag ticks,
 * shorter than the pause before someone reaches for the same control again. */
const COALESCE_MS = 500;

/** How many steps back the stack keeps. Bounded because an entry can be large (a
 * source edit holds a painted mask per keyframe) and a session never reloads. */
const MAX_ENTRIES = 60;

export function createSnapshotHistory<T>() {
	/** States as they were before each change, oldest first. */
	let past = $state<T[]>([]);
	/** States undone away from, newest last, so redo can walk back up. */
	let future = $state<T[]>([]);
	// Edit-clock stamp per entry, so Ctrl+Z can pick this stack over another one.
	let pastSeqs = $state<number[]>([]);
	let futureSeqs = $state<number[]>([]);
	let lastKey: string | null = null;
	let lastAt = 0;
	const canUndo = $derived(past.length > 0);
	const canRedo = $derived(future.length > 0);

	/** Snapshot the state about to be replaced. Call before changing it. */
	function push(before: T, coalesceKey?: string) {
		// The first tick of a gesture holds the state the whole gesture started from;
		// ticks keep the window open, so a slow drag is still one gesture.
		const now = Date.now();
		const continuing =
			!!coalesceKey && coalesceKey === lastKey && now - lastAt < COALESCE_MS;
		lastKey = coalesceKey ?? null;
		lastAt = now;
		if (continuing) return;
		// A fresh edit is a new branch; whatever was undone away from is gone.
		future.length = 0;
		futureSeqs.length = 0;
		past.push($state.snapshot(before) as T);
		pastSeqs.push(nextEditSeq());
		// Oldest out first: the far end of a session is the least likely step wanted back.
		while (past.length > MAX_ENTRIES) {
			past.shift();
			pastSeqs.shift();
		}
	}

	function undo(current: T): T | null {
		if (!canUndo) return null;
		lastKey = null;
		lastAt = 0;
		// What is on screen becomes the thing redo comes back to.
		future.push($state.snapshot(current) as T);
		futureSeqs.push(nextEditSeq());
		pastSeqs.pop();
		return $state.snapshot(past.pop()!) as T;
	}

	function redo(current: T): T | null {
		if (!canRedo) return null;
		lastKey = null;
		lastAt = 0;
		past.push($state.snapshot(current) as T);
		pastSeqs.push(nextEditSeq());
		futureSeqs.pop();
		return $state.snapshot(future.pop()!) as T;
	}

	/** Forget everything. The live state is the caller's and stays untouched. */
	function reset() {
		past = [];
		future = [];
		pastSeqs = [];
		futureSeqs = [];
		lastKey = null;
		lastAt = 0;
	}

	return {
		get canUndo() {
			return canUndo;
		},
		get canRedo() {
			return canRedo;
		},
		/** The state the next undo would restore, for callers skipping a no-op change. */
		get previous(): T | null {
			return past.length > 0 ? past[past.length - 1] : null;
		},
		get undoSeq() {
			return canUndo ? pastSeqs[pastSeqs.length - 1] : NO_EDIT;
		},
		get redoSeq() {
			return canRedo ? futureSeqs[futureSeqs.length - 1] : NO_EDIT;
		},
		push,
		undo,
		redo,
		reset,
	};
}

export type SnapshotHistory<T> = ReturnType<typeof createSnapshotHistory<T>>;

/** The stack as the undo router sees it: `get` hands over the live state for the
 * stack to swap out, `set` puts the restored one back. `pending` marks an edit still
 * on its way to the stack as the newest edit there is, so Ctrl+Z waits for it. */
export function snapshotUndoSource<T>(
	history: SnapshotHistory<T>,
	get: () => T,
	set: (state: T) => void,
	pending: () => boolean = () => false,
): UndoSource {
	return {
		get undoSeq() {
			return pending() ? PENDING_EDIT : history.undoSeq;
		},
		get redoSeq() {
			return history.redoSeq;
		},
		undo: () => {
			const prev = history.undo(get());
			if (prev) set(prev);
		},
		redo: () => {
			const next = history.redo(get());
			if (next) set(next);
		},
	};
}
