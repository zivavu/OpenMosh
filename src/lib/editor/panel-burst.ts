/**
 * Undo bookkeeping for effects-panel edits.
 *
 * Panel edits mutate the effect chain in place, so they can't be recorded from
 * the data itself — they're recorded around the edit instead. Only consecutive
 * ticks of one dragged parameter coalesce (same `coalesceKey`, within
 * `coalesceMs`); discrete edits like toggles each get their own undo entry, so
 * undoing after flipping five effects on takes five steps rather than one.
 *
 * The two undo stacks in the app want opposite timing: a sequence segment
 * stores the state *before* an edit, while the plain effect history stores the
 * state *after* one. `onEditStart` covers both — take the pre-edit snapshot
 * there and return nothing, or return a closure to record once the burst
 * settles.
 */
export interface PanelBurstOptions {
  /**
   * Called when a burst opens, before the edit has been applied. Return a
   * function to run when the burst closes (post-edit recording), or nothing
   * when a snapshot taken here is the whole record.
   */
  onEditStart: () => (() => void) | void;
  /** Coalescing window for one dragged parameter, in ms. */
  coalesceMs?: number;
}

export class PanelBurstController {
  #onEditStart: () => (() => void) | void;
  #coalesceMs: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #key: string | null = null;
  #onClose: (() => void) | null = null;

  constructor({ onEditStart, coalesceMs = 500 }: PanelBurstOptions) {
    this.#onEditStart = onEditStart;
    this.#coalesceMs = coalesceMs;
  }

  /**
   * Call immediately before a panel edit is applied, while the pre-edit state
   * is still intact. `coalesceKey` identifies a continuously-dragged parameter;
   * discrete edits pass nothing.
   */
  beforeEdit(coalesceKey?: string) {
    const key = coalesceKey ?? null;
    // A discrete edit, or a drag that moved to a different parameter, closes
    // whatever burst is open so the two don't share an undo entry.
    if (this.#timer !== undefined && (key === null || key !== this.#key)) {
      this.end();
    }

    if (this.#timer !== undefined) clearTimeout(this.#timer);
    else this.#onClose = this.#onEditStart() ?? null;

    this.#key = key;
    // Discrete edits close on the next tick — just late enough for the
    // mutation to have landed, so the recorded state is the post-edit one.
    this.#timer = setTimeout(
      () => this.end(),
      key === null ? 0 : this.#coalesceMs,
    );
  }

  /**
   * Close the burst and record it. Runs on the coalescing timer, and directly
   * for edits that shouldn't wait it out (preset loads, or an undo that must
   * land on the state before an edit still inside its window).
   */
  end() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#key = null;
    const onClose = this.#onClose;
    this.#onClose = null;
    onClose?.();
  }

  /** Drop a pending burst without recording it — for undo/redo restores. */
  cancel() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#key = null;
    this.#onClose = null;
  }
}
