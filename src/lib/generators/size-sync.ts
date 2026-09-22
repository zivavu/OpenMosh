import { renderSpec } from "./render";
import type { GeneratedSpec } from "./types";

const DEBOUNCE_MS = 400;

/**
 * Keeps generated sources rendered at the output size. Each editor tracks its
 * entries here; after a pause this re-renders the stale ones with a fresh object URL.
 */
export class GeneratedSizeSync {
	#specs = new Map<string, GeneratedSpec>();
	/** "w×h" each entry currently renders at. */
	#at = new Map<string, string>();
	#width = 0;
	#height = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#job: Promise<void> | null = null;
	#disposed = false;
	#apply: (id: string, url: string) => void;

	constructor(apply: (id: string, url: string) => void) {
		this.#apply = apply;
	}

	/** Start managing an entry, given the size its current pixels are. */
	track(id: string, spec: GeneratedSpec, width: number, height: number) {
		this.#specs.set(id, spec);
		this.#at.set(id, `${width}×${height}`);
		this.#schedule();
	}

	untrack(id: string) {
		this.#specs.delete(id);
		this.#at.delete(id);
	}

	has(id: string): boolean {
		return this.#specs.has(id);
	}

	get size(): number {
		return this.#specs.size;
	}

	resize(width: number, height: number) {
		if (width === this.#width && height === this.#height) return;
		this.#width = width;
		this.#height = height;
		this.#schedule();
	}

	/** Run anything pending now and wait for it. */
	async settle(): Promise<void> {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
			this.#run();
		}
		while (this.#job) await this.#job;
	}

	dispose() {
		this.#disposed = true;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		this.#specs.clear();
		this.#at.clear();
	}

	#stale(): string[] {
		const want = `${this.#width}×${this.#height}`;
		return [...this.#specs.keys()].filter((id) => this.#at.get(id) !== want);
	}

	#schedule() {
		if (this.#width <= 0 || this.#height <= 0) return;
		if (this.#stale().length === 0) return;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.#run();
		}, DEBOUNCE_MS);
	}

	#run() {
		if (this.#job) return;
		this.#job = (async () => {
			// Re-read the target each round: the size can move while we work.
			for (;;) {
				const id = this.#stale()[0];
				if (id === undefined || this.#disposed) break;
				const spec = this.#specs.get(id)!;
				const w = this.#width;
				const h = this.#height;
				const blob = await renderSpec(spec, w, h, "image/jpeg").catch(
					() => null,
				);
				if (this.#disposed) break;
				// Removed or re-targeted while rendering: leave it for the next pass.
				if (!blob || !this.#specs.has(id)) continue;
				if (w !== this.#width || h !== this.#height) continue;
				this.#at.set(id, `${w}×${h}`);
				this.#apply(id, URL.createObjectURL(blob));
			}
		})().finally(() => {
			this.#job = null;
		});
	}
}
