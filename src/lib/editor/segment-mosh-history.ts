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

interface Stack {
  entries: SegmentMoshSnapshot[];
  index: number;
}

/**
 * Per-segment ←/→ mosh history for the sequence timeline. Each segment gets
 * its own stack so the arrows always walk the moshes of the thing you're
 * editing, matching how they behave in single mode.
 *
 * Entry 0 is the segment's pre-mosh state, seeded on the first roll, so ←
 * from the first mosh returns to what the segment looked like before it.
 */
export class SegmentMoshHistory {
  #stacks = new Map<string, Stack>();

  /** Record the pre-mosh state once, before the first roll of a segment. */
  seed(segmentId: string, snapshot: SegmentMoshSnapshot): void {
    if (this.#stacks.has(segmentId)) return;
    this.#stacks.set(segmentId, { entries: [snapshot], index: 0 });
  }

  /** Record a fresh roll, dropping any entries the user had stepped back past. */
  push(segmentId: string, snapshot: SegmentMoshSnapshot): void {
    const stack = this.#stacks.get(segmentId);
    if (!stack) {
      this.#stacks.set(segmentId, { entries: [snapshot], index: 0 });
      return;
    }
    stack.entries.length = stack.index + 1;
    stack.entries.push(snapshot);
    stack.index = stack.entries.length - 1;
  }

  undo(segmentId: string): SegmentMoshSnapshot | null {
    const stack = this.#stacks.get(segmentId);
    if (!stack || stack.index <= 0) return null;
    stack.index--;
    return stack.entries[stack.index];
  }

  redo(segmentId: string): SegmentMoshSnapshot | null {
    const stack = this.#stacks.get(segmentId);
    if (!stack || stack.index >= stack.entries.length - 1) return null;
    stack.index++;
    return stack.entries[stack.index];
  }

  /** Drop a deleted segment's stack (also called for merged-away segments). */
  forget(segmentId: string): void {
    this.#stacks.delete(segmentId);
  }

  /** Drop every stack whose segment no longer exists. */
  retain(liveIds: Iterable<string>): void {
    const keep = new Set(liveIds);
    for (const id of [...this.#stacks.keys()]) {
      if (!keep.has(id)) this.#stacks.delete(id);
    }
  }
}
