import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeFontModule } from "../testing/fake-fonts";

/** Real IndexedDB stores on a fake database: what a second upload of the same file or
 * song does to the first one's saved work. */

mock.module("../text-overlay/custom-fonts.svelte", fakeFontModule);

const localData = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => localData.get(k) ?? null,
	setItem: (k: string, v: string) => void localData.set(k, v),
	removeItem: (k: string) => void localData.delete(k),
};

const sessions = await import("./sessions");
const store = await import("./sequence-media-store");
const tracks = await import("../audio/track-library");
const { readProjectNames, uniqueName } = await import("./project-names");
const { deleteRecentEdit, loadStorageInventory } =
	await import("./storage-inventory");

const image = () =>
	new File(["pixels"], "photo.png", { type: "image/png", lastModified: 1 });

async function shownLabel(key: string): Promise<string | undefined> {
	const list = await sessions.listSavedSessions("single");
	const row = list.find((s) => s.key === key);
	return row && (readProjectNames()[key] ?? row.label);
}

beforeEach(async () => {
	await store.clearAllSequenceStores();
	await tracks.clearTracks();
	localData.clear();
});

afterAll(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("uniqueName", () => {
	test("numbers a name only when it's taken", () => {
		expect(uniqueName("a.png", [])).toBe("a.png");
		expect(uniqueName("a.png", ["a.png"])).toBe("a.png (2)");
		expect(uniqueName("a.png", ["a.png", "a.png (2)"])).toBe("a.png (3)");
	});
});

describe("the same image uploaded twice in single mode", () => {
	test("is two projects, and the first keeps its work", async () => {
		const first = sessions.newSessionKey("single");
		const second = sessions.newSessionKey("single");
		expect(first).not.toBe(second);

		await sessions.saveSession(first, "single", [image()], { effects: ["a"] });
		await sessions.saveSession(second, "single", [image()], { effects: ["b"] });

		expect((await sessions.openSession(first))?.state).toEqual({
			effects: ["a"],
		});
		expect((await sessions.openSession(second))?.state).toEqual({
			effects: ["b"],
		});
		expect(await shownLabel(first)).toBe("photo.png");
		expect(await shownLabel(second)).toBe("photo.png (2)");
	});

	test("deleting one leaves the other and the media it shares", async () => {
		const first = sessions.newSessionKey("single");
		const second = sessions.newSessionKey("single");
		await sessions.saveSession(first, "single", [image()], null);
		await sessions.saveSession(second, "single", [image()], null);
		await store.putTimeline(first, { v: 3 });
		await store.putTimeline(second, { v: 3 });

		await deleteRecentEdit("single", first);

		expect(await store.getSession(first)).toBeNull();
		expect(await store.getTimeline(first)).toBeNull();
		expect(await sessions.openSession(second)).not.toBeNull();
		expect(await store.getTimeline(second)).not.toBeNull();
	});
});

describe("the same song used twice", () => {
	test("keeps two single edits apart, each listed on its own", async () => {
		const song = (
			await tracks.addTrack(
				new File(["tune"], "song.wav", { type: "audio/wav" }),
			)
		).id;
		const first = sessions.newSessionKey("single");
		const second = sessions.newSessionKey("single");
		await sessions.saveSession(first, "single", [image()], { n: 1 }, song);
		await sessions.saveSession(second, "single", [image()], { n: 2 }, song);

		expect((await sessions.openSession(first))?.state).toEqual({ n: 1 });
		expect(await shownLabel(second)).toBe("song.wav (2)");

		const loose = (await loadStorageInventory()).looseEdits.map((e) => e.key);
		expect(loose).toContain(first);
		expect(loose).toContain(second);
	});

	test("keeps two slideshows apart", async () => {
		const song = (
			await tracks.addTrack(
				new File(["tune"], "song.wav", { type: "audio/wav" }),
			)
		).id;
		const first = sessions.newSessionKey("slideshow");
		const second = sessions.newSessionKey("slideshow");
		await sessions.saveSession(first, "slideshow", [image()], { n: 1 }, song);
		await sessions.saveSession(second, "slideshow", [image()], { n: 2 }, song);

		expect((await sessions.openSession(first))?.state).toEqual({ n: 1 });
		expect((await sessions.openSession(second))?.state).toEqual({ n: 2 });
	});
});

describe("a slideshow without a song", () => {
	test("saves, lists and survives a prune", async () => {
		const key = sessions.newSessionKey("slideshow");
		expect(
			await sessions.saveSession(key, "slideshow", [image()], { n: 1 }),
		).toBe(true);
		await store.pruneSequenceMedia();

		const list = await sessions.listSavedSessions("slideshow");
		expect(list.map((s) => s.key)).toEqual([key]);
		expect((await sessions.openSession(key))?.state).toEqual({ n: 1 });
	});
});

describe("autosaving an edit", () => {
	test("stores its media once, not again on every save", async () => {
		const key = sessions.newSessionKey("single");
		await sessions.saveSession(key, "single", [image()], { effects: ["a"] });
		const [first] = await store.getAllSequenceMedia();
		await new Promise((r) => setTimeout(r, 5));
		await sessions.saveSession(key, "single", [image()], { effects: ["b"] });
		const all = await store.getAllSequenceMedia();
		expect(all).toHaveLength(1);
		expect(all[0].addedAt).toBe(first.addedAt);
		expect((await sessions.openSession(key))?.state).toEqual({
			effects: ["b"],
		});
	});

	test("writes a saved edit first, so a save started as the page closes lands", async () => {
		const key = sessions.newSessionKey("single");
		await sessions.saveSession(key, "single", [image()], { effects: ["a"] });

		const opened: string[] = [];
		const transaction = IDBDatabase.prototype.transaction;
		IDBDatabase.prototype.transaction = function (
			this: IDBDatabase,
			...args: Parameters<IDBDatabase["transaction"]>
		) {
			opened.push(`${args[1] ?? "readonly"} ${String(args[0])}`);
			return transaction.apply(this, args);
		};
		try {
			await sessions.saveSession(key, "single", [image()], { effects: ["b"] });
		} finally {
			IDBDatabase.prototype.transaction = transaction;
		}
		expect(opened[0]).toBe("readwrite sessions");
		expect((await sessions.openSession(key))?.state).toEqual({
			effects: ["b"],
		});
	});

	test("never lets an older save land over a newer one", async () => {
		const key = sessions.newSessionKey("single");
		await sessions.saveSession(key, "single", [image()], { effects: ["a"] });
		// A different song sends this one through the slow path's lookups.
		const older = sessions.saveSession(
			key,
			"single",
			[image()],
			{ effects: ["old"] },
			"song",
		);
		await sessions.saveSession(key, "single", [image()], { effects: ["new"] });
		await older;
		expect((await sessions.openSession(key))?.state).toEqual({
			effects: ["new"],
		});
	});

	test("starts over once the edit is deleted", async () => {
		const key = sessions.newSessionKey("single");
		await sessions.saveSession(key, "single", [image()], { effects: ["a"] });
		await deleteRecentEdit("single", key);
		await sessions.saveSession(key, "single", [image()], { effects: ["b"] });
		expect(await store.getAllSequenceMedia()).toHaveLength(1);
		expect((await sessions.openSession(key))?.state).toEqual({
			effects: ["b"],
		});
	});
});

/** What another tab announces after it saves or deletes a record. */
async function otherTabNotice(store: string, key: string, at: number | null) {
	const channel = new BroadcastChannel("openmosh-saves");
	channel.postMessage({ id: `${store}\n${key}`, updatedAt: at });
	channel.close();
	await new Promise((r) => setTimeout(r, 10));
}

describe("another tab's save", () => {
	test("isn't overwritten by an older tab's autosave", async () => {
		const key = sessions.newSessionKey("single");
		await sessions.saveSession(key, "single", [image()], { effects: ["a"] });
		const saved = await store.getSession(key);
		// The other tab writes straight to storage, past this tab's view of the record.
		const theirs = Date.now() + 1000;
		await store.putBackupRecords("sessions", [
			{ ...saved, state: { effects: ["theirs"] }, updatedAt: theirs },
		]);
		await otherTabNotice("sessions", key, theirs);
		await expect(
			sessions.saveSession(key, "single", [image()], { effects: ["mine"] }),
		).rejects.toBeInstanceOf(store.StaleWriteError);
		expect((await store.getSession(key))?.state).toEqual({
			effects: ["theirs"],
		});
	});

	test("deleting an edit there keeps it deleted here", async () => {
		const key = sessions.newSessionKey("single");
		await sessions.saveSession(key, "single", [image()], { effects: ["a"] });
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open("openmosh-sequence-media");
			req.onsuccess = () => resolve(req.result);
		});
		await new Promise<void>((resolve) => {
			const tx = db.transaction("sessions", "readwrite");
			tx.objectStore("sessions").delete(key);
			tx.oncomplete = () => resolve();
		});
		db.close();
		await otherTabNotice("sessions", key, null);
		await expect(
			sessions.saveSession(key, "single", [image()], { effects: ["b"] }),
		).rejects.toBeInstanceOf(store.StaleWriteError);
		expect(await store.getSession(key)).toBeNull();
	});
});
