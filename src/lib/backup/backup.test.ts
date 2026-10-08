import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeFontModule, fakeFonts, setFakeFonts } from "../testing/fake-fonts";
import { installFakeLocalStorage } from "../testing/fake-storage";

/** A backup round trip against the real IndexedDB stores on a fake database. Only the
 * font module is mocked (runes, bun can't evaluate). */

mock.module("../text-overlay/custom-fonts.svelte", fakeFontModule);

const local = installFakeLocalStorage();
const store = await import("../editor/sequence-media-store");
const tracks = await import("../audio/track-library");
const { buildBackup, restoreBackup, mergeStoredValue } =
	await import("./backup");
const { writeZip } = await import("../project-file/zip");

beforeEach(async () => {
	await store.clearAllSequenceStores();
	await tracks.clearTracks();
	local.store.clear();
	setFakeFonts([]);
});

afterAll(() => local.restore());

async function wipe() {
	await store.clearAllSequenceStores();
	await tracks.clearTracks();
	local.store.clear();
	setFakeFonts([]);
}

describe("a backup round trip", () => {
	test("brings back media, songs, edits, fonts and settings", async () => {
		const file = new File([new Uint8Array(64).fill(7)], "a.png", {
			type: "image/png",
			lastModified: 1000,
		});
		const id = store.stableSourceId(file);
		await store.putSequenceMedia([{ id, file }]);
		await store.saveMediaPool("proj-1", [id]);
		await store.putTimeline("seq:proj-1", { v: 3, song: "t1" });
		await store.putSession({
			key: "single:track:t1",
			mode: "single",
			label: "song",
			trackId: "t1",
			sourceIds: [id],
			state: { effects: [] },
		});
		await store.putSequenceMediaProxy(file, new Blob([new Uint8Array(8)]));
		await tracks.putTracks([
			{
				id: "t1",
				name: "Song",
				blob: new Blob([new Uint8Array(32).fill(9)], { type: "audio/wav" }),
				addedAt: 5,
			},
		]);
		setFakeFonts([
			{
				id: "f1",
				name: "Glitch",
				family: "'Glitch'",
				sourceUrl: "glitch.woff2",
				addedAt: 1,
				data: new Uint8Array([1, 2, 3]).buffer,
			},
		]);
		local.seedJson("openmosh-settings", { moshMin: 3 });
		local.seedJson("openmosh-project-names", { "proj-1": "Mine" });
		local.seedJson("openmosh-saved-sequences", [{ stale: true }]);
		local.seed("unrelated", "x");

		const backup = await buildBackup();
		await wipe();
		const summary = await restoreBackup(backup);

		expect(summary).toEqual({ media: 1, songs: 1, fonts: 1, edits: 2 });
		const [media] = await store.getAllSequenceMedia();
		expect(media.id).toBe(id);
		expect(media.type).toBe("image/png");
		expect(new Uint8Array(await media.blob.arrayBuffer())[0]).toBe(7);
		expect(await store.loadMediaPool("proj-1")).toEqual([id]);
		expect(await store.getTimeline("seq:proj-1")).toEqual({
			v: 3,
			song: "t1",
		});
		expect((await store.getSession("single:track:t1"))?.sourceIds).toEqual([
			id,
		]);
		expect(await store.getAllSequenceProxies()).toEqual([]);
		const song = await tracks.getTrack("t1");
		expect(song?.name).toBe("Song");
		expect(song?.blob.type).toBe("audio/wav");
		expect(song?.blob.size).toBe(32);
		expect(fakeFonts().map((f) => f.family)).toEqual(["'Glitch'"]);
		expect(local.store.get("openmosh-settings")).toBe('{"moshMin":3}');
		expect(local.store.has("openmosh-saved-sequences")).toBe(false);
		expect(local.store.has("unrelated")).toBe(false);
	});

	test("merges into what the browser already has", async () => {
		local.seedJson("openmosh-project-names", { a: "From backup" });
		local.seedJson("openmosh-presets", [
			{ name: "Backed up", effects: [] },
			{ name: "Both", effects: [{ defId: "blur", enabled: true, values: {} }] },
		]);
		const backup = await buildBackup();
		await wipe();
		local.seedJson("openmosh-project-names", { b: "Here already" });
		local.seedJson("openmosh-presets", [
			{ name: "Local", effects: [] },
			{ name: "Both", effects: [] },
		]);

		await restoreBackup(backup);

		expect(JSON.parse(local.store.get("openmosh-project-names")!)).toEqual({
			b: "Here already",
			a: "From backup",
		});
		// Presets carry no id; a name both sides have takes the backup's.
		expect(JSON.parse(local.store.get("openmosh-presets")!)).toEqual([
			{ name: "Local", effects: [] },
			{ name: "Both", effects: [{ defId: "blur", enabled: true, values: {} }] },
			{ name: "Backed up", effects: [] },
		]);
	});

	test("turns away files that aren't backups", async () => {
		const project = await writeZip([
			{ name: "project.json", blob: new Blob(["{}"]) },
		]);
		await expect(restoreBackup(project)).rejects.toThrow("project file");
		await expect(restoreBackup(new Blob(["nope"]))).rejects.toThrow(
			"isn't an OpenMosh backup",
		);
		const newer = await writeZip([
			{
				name: "backup.json",
				blob: new Blob([
					JSON.stringify({ format: "openmosh-backup", version: 999 }),
				]),
			},
		]);
		await expect(restoreBackup(newer)).rejects.toThrow("newer OpenMosh");
	});
});

describe("mergeStoredValue", () => {
	test("replaces values that aren't maps or record lists", () => {
		expect(mergeStoredValue('["a"]', "[]")).toBe("[]");
		expect(mergeStoredValue("1", "0")).toBe("0");
		expect(mergeStoredValue("not json", "true")).toBe("true");
		expect(mergeStoredValue(null, '{"a":1}')).toBe('{"a":1}');
	});

	test("lets the backup win where both have an entry", () => {
		expect(mergeStoredValue('{"a":1,"b":1}', '{"b":2}')).toBe('{"a":1,"b":2}');
		expect(mergeStoredValue('[{"id":"x","v":1}]', '[{"id":"x","v":2}]')).toBe(
			'[{"id":"x","v":2}]',
		);
	});

	test("keeps what's here when the backup's list is empty", () => {
		expect(mergeStoredValue('[{"name":"mine"}]', "[]")).toBe(
			'[{"name":"mine"}]',
		);
	});
});
