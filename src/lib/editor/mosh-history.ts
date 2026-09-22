import type { EffectInstance } from "../effects";

/** Mosh-relevant slice of a chain clip. Timing (start/end) is excluded so walking
 * the history never moves a clip, only changes what it renders. */
export interface MoshSnapshot {
	effects: EffectInstance[];
	/** "interval" clips mosh by re-seeding rather than by new effects. */
	seed?: number;
	label: string;
	presetName?: string;
	modified?: boolean;
}

interface Stack<T> {
	entries: T[];
	index: number;
}

/** Keyed ←/→ mosh history: each id gets its own stack so the arrows walk the moshes
 * of the thing being edited. Entry 0 is the pre-mosh state, seeded on first roll. */
export class MoshHistory<T> {
	#stacks = new Map<string, Stack<T>>();

	/** Record the pre-mosh state once, before the first roll. */
	seed(id: string, snapshot: T): void {
		if (this.#stacks.has(id)) return;
		this.#stacks.set(id, { entries: [snapshot], index: 0 });
	}

	/** Record a fresh roll, dropping any entries the user had stepped back past. */
	push(id: string, snapshot: T): void {
		const stack = this.#stacks.get(id);
		if (!stack) {
			this.#stacks.set(id, { entries: [snapshot], index: 0 });
			return;
		}
		stack.entries.length = stack.index + 1;
		stack.entries.push(snapshot);
		stack.index = stack.entries.length - 1;
	}

	undo(id: string): T | null {
		const stack = this.#stacks.get(id);
		if (!stack || stack.index <= 0) return null;
		stack.index--;
		return stack.entries[stack.index];
	}

	redo(id: string): T | null {
		const stack = this.#stacks.get(id);
		if (!stack || stack.index >= stack.entries.length - 1) return null;
		stack.index++;
		return stack.entries[stack.index];
	}

	forget(id: string): void {
		this.#stacks.delete(id);
	}

	retain(liveIds: Iterable<string>): void {
		const keep = new Set(liveIds);
		for (const id of [...this.#stacks.keys()]) {
			if (!keep.has(id)) this.#stacks.delete(id);
		}
	}
}
