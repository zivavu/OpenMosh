import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	createListCache,
	readJson,
	readRaw,
	writeJson,
	writeRaw,
} from "./storage";
import {
	type FakeLocalStorage,
	installFakeLocalStorage,
} from "./testing/fake-storage";

let ls: FakeLocalStorage;

beforeEach(() => {
	ls = installFakeLocalStorage();
});

afterEach(() => {
	ls.restore();
});

describe("readJson", () => {
	it("round-trips what writeJson stored", () => {
		writeJson("k", { a: 1, b: ["two"] });
		expect(readJson("k", null)).toEqual({ a: 1, b: ["two"] });
	});

	it("falls back when the key was never written", () => {
		expect(readJson("missing", "fallback")).toBe("fallback");
	});

	it("falls back on a half-written or hand-edited value", () => {
		ls.seed("k", "{not json");
		expect(readJson("k", "fallback")).toBe("fallback");
	});

	it("falls back when localStorage itself throws", () => {
		ls.seedJson("k", 1);
		ls.unavailable = true;
		expect(readJson("k", "fallback")).toBe("fallback");
	});

	it("tells a stored null apart from a missing key", () => {
		// loadPresets leans on this: a stored [] must not re-seed the starters.
		ls.seedJson("k", null);
		expect(readJson<unknown>("k", "fallback")).toBeNull();
	});
});

describe("writeJson", () => {
	it("reports success", () => {
		expect(writeJson("k", 1)).toBe(true);
	});

	it("reports a full quota instead of throwing", () => {
		ls.full = true;
		expect(writeJson("k", 1)).toBe(false);
	});

	it("reports a private window instead of throwing", () => {
		ls.unavailable = true;
		expect(writeJson("k", 1)).toBe(false);
	});

	it("reports a value that can't be serialized", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(writeJson("k", cyclic)).toBe(false);
	});
});

describe("readRaw / writeRaw", () => {
	it("round-trips a string", () => {
		expect(writeRaw("k", "1")).toBe(true);
		expect(readRaw("k")).toBe("1");
	});

	it("is null for a missing key", () => {
		expect(readRaw("missing")).toBeNull();
	});

	it("survives an unavailable store on both sides", () => {
		ls.unavailable = true;
		expect(writeRaw("k", "1")).toBe(false);
		expect(readRaw("k")).toBeNull();
	});
});

describe("createListCache", () => {
	interface Entry {
		id: string;
	}
	const isEntry = (v: unknown): v is Entry =>
		!!v && typeof v === "object" && typeof (v as Entry).id === "string";
	const cache = () => createListCache<Entry>("list", isEntry);

	it("round-trips a list", () => {
		cache().write([{ id: "a" }, { id: "b" }]);
		expect(cache().read()).toEqual([{ id: "a" }, { id: "b" }]);
	});

	it("is empty before anything was written", () => {
		expect(cache().read()).toEqual([]);
	});

	it("is empty when the key holds something that isn't a list", () => {
		ls.seedJson("list", { id: "a" });
		expect(cache().read()).toEqual([]);
	});

	it("drops the entries that no longer validate, keeping the rest", () => {
		// The mirror outlives schema changes: an entry written by an older build
		// shouldn't take the whole upload screen down with it.
		ls.seedJson("list", [{ id: "a" }, null, { wrong: true }, 7, { id: "b" }]);
		expect(cache().read()).toEqual([{ id: "a" }, { id: "b" }]);
	});

	it("is empty rather than throwing when the store is gone", () => {
		ls.seedJson("list", [{ id: "a" }]);
		ls.unavailable = true;
		expect(cache().read()).toEqual([]);
	});

	it("swallows a failed write, since the real list lives in IndexedDB", () => {
		ls.full = true;
		expect(() => cache().write([{ id: "a" }])).not.toThrow();
	});
});
