/** Undo bookkeeping for effects-panel edits, which mutate the chain in place. */
export interface PanelBurstOptions {
	/** Called when a burst opens, before the edit is applied; may return a close handler. */
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

	/** True while a burst is open: an edit applied but not yet recorded on its stack. */
	get open(): boolean {
		return this.#timer !== undefined;
	}

	/** Call immediately before a panel edit is applied, while the pre-edit state is intact. */
	beforeEdit(coalesceKey?: string) {
		const key = coalesceKey ?? null;
		// A discrete edit, or a drag moved to a different parameter, closes the open burst.
		if (this.#timer !== undefined && (key === null || key !== this.#key)) {
			this.end();
		}

		if (this.#timer !== undefined) clearTimeout(this.#timer);
		else this.#onClose = this.#onEditStart() ?? null;

		this.#key = key;
		// Discrete edits close on the next tick, just late enough for the mutation to land.
		this.#timer = setTimeout(
			() => this.end(),
			key === null ? 0 : this.#coalesceMs,
		);
	}

	/** Close the burst and record it. */
	end() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#key = null;
		const onClose = this.#onClose;
		this.#onClose = null;
		onClose?.();
	}

	/** Drop a pending burst without recording it, for undo/redo restores. */
	cancel() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#key = null;
		this.#onClose = null;
	}
}
