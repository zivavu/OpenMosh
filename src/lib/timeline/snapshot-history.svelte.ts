/**
 * Snapshot undo stack for a whole timeline document — the text timeline, the
 * sequence fx lanes, a source's own edits. Kept apart from the effect-chain
 * stacks because those are typed to effect arrays, and because rewinding a mosh
 * is not what a mistyped caption or a nudged clip calls for.
 *
 * **Callers push the state they are about to replace**, immediately before
 * changing it, and hand the live state to `undo`/`redo`. The live state is
 * never in the stack — which is the whole reason for that shape. The obvious
 * alternative, storing states as they land, cannot record the state *before*
 * the first tick of a coalesced gesture, so undoing a slider sweep would stop
 * at wherever the sweep's first frame happened to be.
 *
 * (This used to hold a single array with an index and a seed, fed by callers
 * that pushed the *previous* state — the two disagreed, and every undo stepped
 * back two edits at once: two erase strokes vanished on one Ctrl+Z.)
 *
 * `coalesceKey` merges the ticks of one continuous gesture (a clip drag, a
 * slider sweep) into a single entry, so undo steps back the whole gesture. It
 * lapses after a pause: a control has no way to say "that gesture is over", so
 * without a timeout two sweeps of the *same* slider, minutes apart, merged into
 * one entry and one undo threw away both.
 */

import { NO_EDIT, nextEditSeq } from "../editor/edit-clock";

/**
 * How long a coalesce key stays live. Longer than the gap between the ticks of
 * a drag (a frame) by a wide margin, shorter than the pause before someone
 * reaches for the same control a second time.
 */
const COALESCE_MS = 500;

/**
 * How many steps back the stack keeps. Bounded because an entry can be large —
 * a source edit holds a painted mask per keyframe — and an editing session that
 * never reloads would otherwise hold every bitmap it ever replaced. Deep enough
 * that stepping back through a stretch of work still works.
 */
const MAX_ENTRIES = 60;

export function createSnapshotHistory<T>() {
  /** States as they were before each change, oldest first. */
  let past = $state<T[]>([]);
  /** States undone away from, newest last, so redo can walk back up. */
  let future = $state<T[]>([]);
  // Edit-clock stamp per entry, so Ctrl+Z can pick this stack over another one
  // only when this is where the newest edit landed.
  let pastSeqs = $state<number[]>([]);
  let futureSeqs = $state<number[]>([]);
  let lastKey: string | null = null;
  let lastAt = 0;
  const canUndo = $derived(past.length > 0);
  const canRedo = $derived(future.length > 0);

  /** Snapshot the state about to be replaced. Call before changing it. */
  function push(before: T, coalesceKey?: string) {
    // The first tick of a gesture is the one worth keeping: it holds the state
    // the whole gesture started from. Ticks keep the window open, so a slow
    // drag is still one gesture however long it runs.
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
    // Oldest out first: the far end of a long session is the least likely step
    // to be wanted back, and holding it pins every bitmap it references.
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
    /** The state the next undo would restore, for callers that want to skip a
     * change that would put things back where they already are. */
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
