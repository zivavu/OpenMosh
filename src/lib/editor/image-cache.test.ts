import { describe, expect, test } from "bun:test";
import { ImageCache, type DecodedImage } from "./image-cache";

interface Fake extends DecodedImage {
	id: string;
	closed: boolean;
}

/** 1 byte-unit images: 1x1 is 4 bytes. */
function setup(opts: { maxBytes?: number; minEntries?: number } = {}) {
	const pending = new Map<string, (img: Fake | null) => void>();
	const made: Fake[] = [];
	const cache = new ImageCache<Fake>({
		decode: (id) =>
			new Promise((resolve) => {
				pending.set(id, resolve);
			}),
		stillWanted: () => true,
		maxBytes: opts.maxBytes ?? 4 * 3,
		minEntries: opts.minEntries ?? 1,
		maxPrefetching: 2,
	});
	const finish = async (id: string) => {
		const img: Fake = {
			id,
			width: 1,
			height: 1,
			closed: false,
			close() {
				img.closed = true;
			},
		};
		made.push(img);
		pending.get(id)!(img);
		pending.delete(id);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	};
	return { cache, pending, made, finish };
}

describe("ImageCache", () => {
	test("decodes on a miss and serves the hit after", async () => {
		const { cache, finish } = setup();
		expect(cache.get("a")).toBeUndefined();
		await finish("a");
		expect(cache.get("a")?.id).toBe("a");
	});

	test("evicts the least recently used past the budget, and closes it", async () => {
		const { cache, finish, made } = setup();
		for (const id of ["a", "b", "c"]) {
			cache.get(id);
			await finish(id);
		}
		cache.get("a");
		cache.get("d");
		await finish("d");
		expect(cache.bytes).toBe(12);
		expect(made.find((m) => m.id === "b")?.closed).toBe(true);
		expect(cache.get("a")?.id).toBe("a");
	});

	test("prefetches a few at a time and spares what plays next", async () => {
		const { cache, pending, finish } = setup();
		cache.prefetch(["a", "b", "c"]);
		expect([...pending.keys()]).toEqual(["a", "b"]);
		await finish("a");
		await finish("b");
		cache.prefetch(["a", "b", "c"]);
		await finish("c");
		cache.get("x");
		await finish("x");
		// Over budget, but everything else is upcoming: only the newest may stay over.
		expect(cache.get("a")?.id).toBe("a");
		expect(cache.get("b")?.id).toBe("b");
		expect(cache.get("c")?.id).toBe("c");
	});

	test("a decode that finishes after a drop is thrown away", async () => {
		const { cache, finish, made } = setup();
		cache.get("a");
		cache.drop("a");
		await finish("a");
		expect(made[0].closed).toBe(true);
		expect(cache.bytes).toBe(0);
	});
});
