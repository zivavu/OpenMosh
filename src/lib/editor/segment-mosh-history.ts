import type { EffectInstance } from "../effects";

/**
 * The mosh-relevant slice of a sequence segment. Timing (start/end) and
 * transitions are deliberately excluded: walking the mosh history must not
 * move a segment or change how it blends in, only what it renders.
 */
export interface SegmentMoshSnapshot {
  effects: EffectInstance[];
  /** "interval" segments mosh by re-seeding rather than by new effects. */
  seed?: number;
  label: string;
  presetName?: string;
  modified?: boolean;
}

interface Stack<T> {
  entries: T[];
  index: number;
}

/**
 * Keyed ←/→ mosh history. Each id gets its own stack so the arrows always walk
 * the moshes of the thing you're editing, matching how they behave in single
 * mode — sequence segments and fx clips key by clip id, layer lanes by lane id.
 *
 * Entry 0 is the pre-mosh state, seeded on the first roll, so ← from the first
 * mosh returns to what was there before it.
 */
export class MoshHistory<T> {
  #stacks = new Map<string, Stack<T>>();

  /** Record the pre-mosh state once, before the first roll. */
  seed(segmentId: string, snapshot: T): void {
    if (this.#stacks.has(segmentId)) return;
    this.#stacks.set(segmentId, { entries: [snapshot], index: 0 });
  }

  /** Record a fresh roll, dropping any entries the user had stepped back past. */
  push(segmentId: string, snapshot: T): void {
    const stack = this.#stacks.get(segmentId);
    if (!stack) {
      this.#stacks.set(segmentId, { entries: [snapshot], index: 0 });
      return;
    }
    stack.entries.length = stack.index + 1;
    stack.entries.push(snapshot);
    stack.index = stack.entries.length - 1;
  }

  undo(segmentId: string): T | null {
    const stack = this.#stacks.get(segmentId);
    if (!stack || stack.index <= 0) return null;
    stack.index--;
    return stack.entries[stack.index];
  }

  redo(segmentId: string): T | null {
    const stack = this.#stacks.get(segmentId);
    if (!stack || stack.index >= stack.entries.length - 1) return null;
    stack.index++;
    return stack.entries[stack.index];
  }

  /** Drop a deleted thing's stack (also called for merged-away segments). */
  forget(segmentId: string): void {
    this.#stacks.delete(segmentId);
  }

  /** Drop every stack whose owner no longer exists. */
  retain(liveIds: Iterable<string>): void {
    const keep = new Set(liveIds);
    for (const id of [...this.#stacks.keys()]) {
      if (!keep.has(id)) this.#stacks.delete(id);
    }
  }
}
