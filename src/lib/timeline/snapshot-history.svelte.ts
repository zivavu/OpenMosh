/**
 * Snapshot undo stack for a whole timeline document — the text timeline, the
 * sequence fx lanes. Kept apart from the effect-chain stacks because those are
 * typed to effect arrays, and because rewinding a mosh is not what a mistyped
 * caption or a nudged clip calls for.
 *
 * `coalesceKey` merges the ticks of one continuous gesture (a clip drag, a
 * slider sweep) into a single entry, so undo steps back a whole gesture.
 */

import { NO_EDIT, nextEditSeq } from "../editor/edit-clock";

export function createSnapshotHistory<T>(initial: T) {
  let history = $state<T[]>([$state.snapshot(initial) as T]);
  // Edit-clock stamp per entry, so Ctrl+Z can pick this stack over another
  // one only when this is where the newest edit landed. The seed entry is not
  // an edit, hence NO_EDIT.
  let seqs = $state<number[]>([NO_EDIT]);
  let index = $state(0);
  let lastKey: string | null = null;
  const canUndo = $derived(index > 0);
  const canRedo = $derived(index < history.length - 1);

  function push(value: T, coalesceKey?: string) {
    if (coalesceKey && coalesceKey === lastKey) return;
    lastKey = coalesceKey ?? null;
    history.length = index + 1;
    seqs.length = index + 1;
    history.push($state.snapshot(value) as T);
    seqs.push(nextEditSeq());
    index = history.length - 1;
  }

  function undo(): T | null {
    if (!canUndo) return null;
    lastKey = null;
    // The entry left behind is now the newest thing to redo.
    seqs[index] = nextEditSeq();
    index--;
    return $state.snapshot(history[index]) as T;
  }

  function redo(): T | null {
    if (!canRedo) return null;
    lastKey = null;
    index++;
    seqs[index] = nextEditSeq();
    return $state.snapshot(history[index]) as T;
  }

  function reset(value: T) {
    history = [$state.snapshot(value) as T];
    seqs = [NO_EDIT];
    index = 0;
    lastKey = null;
  }

  return {
    get canUndo() {
      return canUndo;
    },
    get canRedo() {
      return canRedo;
    },
    /** The entry the stack is sitting on. */
    get current(): T {
      return history[index];
    },
    get undoSeq() {
      return canUndo ? seqs[index] : NO_EDIT;
    },
    get redoSeq() {
      return canRedo ? seqs[index + 1] : NO_EDIT;
    },
    push,
    undo,
    redo,
    reset,
  };
}
