/** Decoded pool images, least recently used first, held to a memory budget. */

export interface DecodedImage {
	width: number;
	height: number;
	close?: () => void;
}

export interface ImageCacheOptions<T extends DecodedImage> {
	/** Null when the picture can't be drawn. */
	decode: (id: string) => Promise<T | null>;
	/** Whether a finished decode still matches the source: it may have changed or left. */
	stillWanted: (id: string) => boolean;
	onReady?: () => void;
	maxBytes: number;
	/** Kept whatever their size, as a floor under huge images. */
	minEntries: number;
	/** In flight at once for prefetches; a decode asked for now always starts. */
	maxPrefetching: number;
}

const bytesOf = (image: DecodedImage) => image.width * image.height * 4;

export class ImageCache<T extends DecodedImage> {
	#opts: ImageCacheOptions<T>;
	#images = new Map<string, T>();
	#bytes = 0;
	#decoding = new Set<string>();
	/** The latest prefetch: these stay put while the budget is tight. */
	#upcoming = new Set<string>();
	/** Bumped on a drop, so a decode that started before it is thrown away. */
	#generation = new Map<string, number>();

	constructor(opts: ImageCacheOptions<T>) {
		this.#opts = opts;
	}

	get bytes(): number {
		return this.#bytes;
	}

	/** Undefined while it decodes; the caller holds what it showed before. */
	get(id: string): T | undefined {
		const hit = this.#touch(id);
		if (!hit) this.#decode(id);
		return hit;
	}

	/** Decode what is about to be shown, soonest first, while the budget has room. */
	prefetch(ids: readonly string[]) {
		this.#upcoming = new Set(ids);
		for (const id of [...ids].reverse()) this.#touch(id);
		for (const id of ids) {
			if (this.#decoding.size >= this.#opts.maxPrefetching) break;
			if (this.#bytes >= this.#opts.maxBytes) break;
			if (!this.#images.has(id)) this.#decode(id);
		}
	}

	drop(id: string) {
		this.#generation.set(id, (this.#generation.get(id) ?? 0) + 1);
		const held = this.#images.get(id);
		if (!held) return;
		this.#images.delete(id);
		this.#bytes -= bytesOf(held);
		held.close?.();
	}

	clear() {
		for (const id of [...this.#images.keys()]) this.drop(id);
	}

	#touch(id: string): T | undefined {
		const hit = this.#images.get(id);
		if (hit) {
			this.#images.delete(id);
			this.#images.set(id, hit);
		}
		return hit;
	}

	#decode(id: string) {
		if (this.#decoding.has(id)) return;
		this.#decoding.add(id);
		const generation = this.#generation.get(id) ?? 0;
		void this.#opts
			.decode(id)
			.catch(() => null)
			.then((image) => {
				this.#decoding.delete(id);
				if (!image) return;
				if (
					(this.#generation.get(id) ?? 0) !== generation ||
					!this.#opts.stillWanted(id)
				) {
					image.close?.();
					return;
				}
				this.drop(id);
				this.#images.set(id, image);
				this.#bytes += bytesOf(image);
				this.#evict(id);
				this.#opts.onReady?.();
			});
	}

	/** Oldest first, sparing what was just decoded and what plays next. */
	#evict(keep: string) {
		for (const id of [...this.#images.keys()]) {
			if (this.#bytes <= this.#opts.maxBytes) return;
			if (this.#images.size <= this.#opts.minEntries) return;
			if (id === keep || this.#upcoming.has(id)) continue;
			this.drop(id);
		}
	}
}
