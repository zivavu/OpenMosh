/** Whether Edit media is up, from every place that can open it. Each reports for
 * itself: one saying "closed" mustn't end a session another has open. */
export class SourceEditSession<Reporter extends string> {
	#open = new Set<Reporter>();
	readonly #onOpen: () => void;
	readonly #onClose: () => void;

	constructor({
		onOpen,
		onClose,
	}: {
		onOpen: () => void;
		onClose: () => void;
	}) {
		this.#onOpen = onOpen;
		this.#onClose = onClose;
	}

	get isOpen(): boolean {
		return this.#open.size > 0;
	}

	/** Repeats are no-ops, so an effect may report on every run. */
	report(reporter: Reporter, open: boolean) {
		const was = this.isOpen;
		if (open) this.#open.add(reporter);
		else this.#open.delete(reporter);
		if (!was && this.isOpen) this.#onOpen();
		else if (was && !this.isOpen) this.#onClose();
	}
}
