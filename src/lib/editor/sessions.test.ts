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
