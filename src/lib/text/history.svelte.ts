import { EMPTY_TEXT_TIMELINE, type TextTimeline } from "./types";

/**
 * Undo stack for the text timeline, separate from the effect-chain stacks
 * because those are typed to effect arrays and because rewinding a mosh is not
 * what a mistyped caption calls for.
 *
 * `coalesceKey` merges the ticks of one continuous gesture (a clip drag, a
 * slider sweep) into a single entry, so undo steps back a whole gesture.
 */
export function createTextHistory() {
  let history = $state<TextTimeline[]>([{ ...EMPTY_TEXT_TIMELINE }]);
  let index = $state(0);
  let lastKey: string | null = null;
  const canUndo = $derived(index > 0);
  const canRedo = $derived(index < history.length - 1);

  function push(timeline: TextTimeline, coalesceKey?: string) {
    if (coalesceKey && coalesceKey === lastKey) return;
    lastKey = coalesceKey ?? null;
    history.length = index + 1;
    history.push(structuredClone(timeline));
    index = history.length - 1;
  }

  function undo(): TextTimeline | null {
    if (!canUndo) return null;
    lastKey = null;
    index--;
    return structuredClone(history[index]);
  }

  function redo(): TextTimeline | null {
    if (!canRedo) return null;
    lastKey = null;
    index++;
    return structuredClone(history[index]);
  }

  function reset(timeline: TextTimeline) {
    history = [structuredClone(timeline)];
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
