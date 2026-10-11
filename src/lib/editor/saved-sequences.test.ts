import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { installFakeLocalStorage } from "../testing/fake-storage";

const storage = installFakeLocalStorage();
const store = await import("./sequence-media-store");
const tracks = await import("../audio/track-library");
const { listSavedSequences, openSavedSequence } =
	await import("./saved-sequences");

const photo = new File(["pixels"], "photo.png", {
	type: "image/png",
	lastModified: 1,
});

beforeEach(async () => {
	await store.clearAllSequenceStores();
	await tracks.clearTracks();
	storage.store.clear();
});

afterAll(() => storage.restore());

describe("an editor project", () => {
	test("is listed and opens with its media", async () => {
		const id = store.stableSourceId(photo);
		await store.putSequenceMedia([{ id, file: photo }]);
		await store.saveMediaPool("proj-a", [id]);
		const [row] = await listSavedSequences();
		expect(row).toMatchObject({ trackId: "proj-a", sourceCount: 1 });
		const opened = await openSavedSequence("proj-a");
		expect(opened?.sources.map((f) => f.name)).toEqual(["photo.png"]);
	});

	test("whose pool was emptied is still listed, and opens with no media", async () => {
		await store.saveMediaPool("proj-a", []);
		const [row] = await listSavedSequences();
		expect(row).toMatchObject({ trackId: "proj-a", sourceCount: 0 });
		const opened = await openSavedSequence("proj-a");
		expect(opened).not.toBeNull();
		expect(opened?.sources).toEqual([]);
	});

	test("keyed by a song that's gone isn't offered", async () => {
		await store.saveMediaPool("missing-song", []);
		expect(await listSavedSequences()).toEqual([]);
		expect(await openSavedSequence("missing-song")).toBeNull();
	});
});
