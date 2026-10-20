import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	installFakeLocalStorage,
	type FakeLocalStorage,
} from "../testing/fake-storage";
import { clearAllSequenceStores, putTimeline } from "./sequence-media-store";
import { loadTimeline } from "./timeline-store";

let storage: FakeLocalStorage;
const realTransaction = IDBDatabase.prototype.transaction;

/** Every read fails, the way a lost IndexedDB connection does. */
function breakIndexedDb() {
	IDBDatabase.prototype.transaction = () => {
		throw new DOMException("Connection lost", "UnknownError");
	};
}

beforeEach(async () => {
	storage = installFakeLocalStorage();
	await clearAllSequenceStores();
});

afterEach(() => {
	IDBDatabase.prototype.transaction = realTransaction;
	storage.restore();
});

describe("loadTimeline", () => {
	test("reads a stored timeline", async () => {
		await putTimeline("seq:a", { v: 4 });
		expect(await loadTimeline("seq:a")).toEqual({ v: 4 });
	});

	test("is null when nothing is saved", async () => {
		expect(await loadTimeline("seq:missing")).toBeNull();
	});

	test("throws when the read fails, rather than calling the project empty", async () => {
		await putTimeline("seq:a", { v: 4 });
		breakIndexedDb();
		await expect(loadTimeline("seq:a")).rejects.toThrow("Connection lost");
	});

	test("falls back to the legacy copy when nothing is stored", async () => {
		storage.seedJson("openmosh-sequence", { "seq:old": { v: 1 } });
		expect(await loadTimeline("seq:old")).toEqual({ v: 1 });
	});

	test("throws when the read fails, even with an older legacy copy", async () => {
		storage.seedJson("openmosh-sequence", { "seq:a": { v: 1 } });
		await putTimeline("seq:a", { v: 4 });
		breakIndexedDb();
		await expect(loadTimeline("seq:a")).rejects.toThrow("Connection lost");
		IDBDatabase.prototype.transaction = realTransaction;
		expect(await loadTimeline("seq:a")).toEqual({ v: 4 });
	});
});
