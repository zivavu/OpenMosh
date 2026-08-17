/**
 * Snapshot undo stack for a whole timeline document — the text timeline, the
 * sequence fx lanes. Kept apart from the effect-chain stacks because those are
 * typed to effect arrays, and because rewinding a mosh is not what a mistyped
 * caption or a nudged clip calls for.
 *
 * `coalesceKey` merges the ticks of one continuous gesture (a clip drag, a
 * slider sweep) into a single entry, so undo steps back a whole gesture.
 */
export function createSnapshotHistory<T>(initial: T) {
  let history = $state<T[]>([$state.snapshot(initial) as T]);
  let index = $state(0);
  let lastKey: string | null = null;
  const canUndo = $derived(index > 0);
  const canRedo = $derived(index < history.length - 1);

  function push(value: T, coalesceKey?: string) {
    if (coalesceKey && coalesceKey === lastKey) return;
    lastKey = coalesceKey ?? null;
    history.length = index + 1;
    history.push($state.snapshot(value) as T);
    index = history.length - 1;
  }

  function undo(): T | null {
    if (!canUndo) return null;
    lastKey = null;
    index--;
    return $state.snapshot(history[index]) as T;
  }

  function redo(): T | null {
    if (!canRedo) return null;
    lastKey = null;
    index++;
    return $state.snapshot(history[index]) as T;
  }

  function reset(value: T) {
    history = [$state.snapshot(value) as T];
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
    push,
    undo,
    redo,
    reset,
  };
}
