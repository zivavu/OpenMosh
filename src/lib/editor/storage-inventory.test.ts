import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

/** Runs against the real IndexedDB stores on a fake database, so the deletion logic
 * is asserted as it ships. Only the font module is mocked (runes, bun can't evaluate). */

interface FakeFont {
	id: string;
	name: string;
	family: string;
	sourceUrl: string;
	addedAt: number;
}
let fonts: FakeFont[] = [];
let fontSizes = new Map<string, number>();

mock.module("../text-overlay/custom-fonts.svelte", () => ({
	customFonts: () => fonts,
	getCustomFontSizes: async () => new Map(fontSizes),
	removeCustomFont: async (id: string) => {
		fonts = fonts.filter((f) => f.id !== id);
		fontSizes.delete(id);
	},
}));

/** localStorage is absent under bun; the per-song stores need a stand-in. */
const localData = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => localData.get(k) ?? null,
	setItem: (k: string, v: string) => void localData.set(k, v),
	removeItem: (k: string) => void localData.delete(k),
};

const inventory = await import("./storage-inventory");
const store = await import("./sequence-media-store");
const tracks = await import("../audio/track-library");
const { readJson, writeJson } = await import("../storage");

const {
	deleteEverything,
	deleteAllProxies,
	deleteLooseEdit,
	deleteProject,
	deleteUnassignedMedia,
	loadStorageInventory,
} = inventory;

function bytes(n: number): string {
	return "x".repeat(n);
}

function mediaFile(name: string, size: number, mtime = 1_700_000_000_000) {
	return new File([bytes(size)], name, {
		type: "image/png",
		lastModified: mtime,
	});
}

async function seedMedia(name: string, size: number, mtime?: number) {
	const file = mediaFile(name, size, mtime);
	const id = store.stableSourceId(file);
	await store.putSequenceMedia([{ id, file }]);
	return { id, file };
}

async function seedTrack(name: string, size: number) {
	const file = new File([bytes(size)], name, { type: "audio/wav" });
	return (await tracks.addTrack(file)).id;
}

async function idsInStore(): Promise<string[]> {
	return [...(await store.getAllSequenceMediaIds())].sort();
}

beforeEach(async () => {
	await store.clearAllSequenceStores();
	await tracks.clearTracks();
	localData.clear();
	fonts = [];
	fontSizes = new Map();
});

afterAll(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("loadStorageInventory", () => {
	test("an empty database reads as empty", async () => {
		const inv = await loadStorageInventory();
		expect(inv.projects).toEqual([]);
		expect(inv.looseEdits).toEqual([]);
		expect(inv.unassigned).toEqual([]);
		expect(inv.proxyCount).toBe(0);
		expect(inv.fonts).toEqual([]);
		expect(inv.totals).toEqual({
			media: 0,
			tracks: 0,
			proxies: 0,
			work: 0,
			fonts: 0,
		});
		// bun has no navigator.storage; the inventory must not pretend otherwise.
		expect(inv.usage).toBeNull();
		expect(inv.quota).toBeNull();
		expect(inv.persisted).toBeNull();
	});

	test("groups everything keyed to a song under one project", async () => {
		const trackId = await seedTrack("song.wav", 1000);
		const a = await seedMedia("a.png", 300);
		const b = await seedMedia("b.png", 200);
		const c = await seedMedia("c.png", 100);
		await store.saveMediaPool(trackId, [a.id, b.id]);
		await store.putTimeline(`seq:${trackId}`, { segments: [1, 2, 3] });
		await store.putSession({
			key: `single:track:${trackId}`,
			mode: "single",
			label: "song.wav",
			trackId,
			sourceIds: [c.id],
			state: { effects: [] },
		});
		await store.putSession({
			key: `slideshow:track:${trackId}`,
			mode: "slideshow",
			label: "song.wav",
			trackId,
			// Overlaps the pool: the same blob must not be listed twice.
			sourceIds: [a.id, c.id],
			state: { config: {} },
		});

		const inv = await loadStorageInventory();
		expect(inv.projects).toHaveLength(1);
		const p = inv.projects[0];
		expect(p.trackId).toBe(trackId);
		expect(p.name).toBe("song.wav");
		expect(p.trackSize).toBe(1000);
		expect(p.modes).toEqual(["sequence", "single", "slideshow"]);
		expect(p.media.map((m) => m.name)).toEqual(["a.png", "b.png", "c.png"]);
		expect(p.mediaSize).toBe(600);
		expect(p.workSize).toBeGreaterThan(0);
		expect(p.updatedAt).toBeGreaterThan(0);
		expect(inv.looseEdits).toEqual([]);
		expect(inv.unassigned).toEqual([]);
		expect(inv.totals.media).toBe(600);
		expect(inv.totals.tracks).toBe(1000);
	});

	test("a song with no work is still a project, with no modes", async () => {
		const trackId = await seedTrack("bare.wav", 50);
		const inv = await loadStorageInventory();
		expect(inv.projects).toHaveLength(1);
		expect(inv.projects[0].trackId).toBe(trackId);
		expect(inv.projects[0].modes).toEqual([]);
		expect(inv.projects[0].media).toEqual([]);
		expect(inv.projects[0].updatedAt).toBe(0);
	});

	test("a timeline alone marks the mode, even with no pool or session", async () => {
		const trackId = await seedTrack("t.wav", 10);
		await store.putTimeline(`single:${trackId}`, { effects: [] });
		const inv = await loadStorageInventory();
		expect(inv.projects[0].modes).toEqual(["single"]);
	});

	test("counts how many projects share each blob", async () => {
		const t1 = await seedTrack("one.wav", 10);
		const t2 = await seedTrack("two.wav", 10);
		const shared = await seedMedia("shared.png", 100);
		const own = await seedMedia("own.png", 100);
		await store.saveMediaPool(t1, [shared.id, own.id]);
		await store.saveMediaPool(t2, [shared.id]);

		const inv = await loadStorageInventory();
		const byName = (p: (typeof inv.projects)[number]) =>
			Object.fromEntries(p.media.map((m) => [m.name, m.refs]));
		const one = inv.projects.find((p) => p.trackId === t1)!;
		const two = inv.projects.find((p) => p.trackId === t2)!;
		expect(byName(one)).toEqual({ "shared.png": 2, "own.png": 1 });
		expect(byName(two)).toEqual({ "shared.png": 2 });
	});

	test("lists media nothing references as unassigned", async () => {
		const trackId = await seedTrack("t.wav", 10);
		const used = await seedMedia("used.png", 100);
		const loose = await seedMedia("loose.png", 250);
		await store.saveMediaPool(trackId, [used.id]);

		const inv = await loadStorageInventory();
		expect(inv.unassigned.map((m) => m.name)).toEqual(["loose.png"]);
		expect(inv.unassigned[0].size).toBe(250);
		expect(inv.unassigned[0].refs).toBe(0);
		expect(loose.id).not.toBe(used.id);
	});

	test("a session with no song is a loose edit named by its media", async () => {
		const img = await seedMedia("photo.png", 40);
		await store.putSession({
			key: `single:${img.id}`,
			mode: "single",
			label: "photo.png",
			sourceIds: [img.id],
			state: { effects: [1, 2] },
		});
		const inv = await loadStorageInventory();
		expect(inv.projects).toEqual([]);
		expect(inv.looseEdits).toHaveLength(1);
		const e = inv.looseEdits[0];
		expect(e.kind).toBe("session");
		expect(e.mode).toBe("single");
		expect(e.label).toBe("photo.png");
		expect(e.media.map((m) => m.name)).toEqual(["photo.png"]);
		expect(e.mediaSize).toBe(40);
		expect(e.workSize).toBeGreaterThan(0);
	});

	test("a session keyed to a song that's been removed is loose, not lost", async () => {
		const img = await seedMedia("p.png", 10);
		await store.putSession({
			key: "single:track:gone",
			mode: "single",
			label: "was a song",
			trackId: "gone",
			sourceIds: [img.id],
			state: {},
		});
		const inv = await loadStorageInventory();
		expect(inv.looseEdits.map((e) => e.label)).toEqual(["was a song"]);
	});

	test("a video-driven pool is a loose editor edit, named from its key", async () => {
		const clip = mediaFile("my clip.mp4", 5);
		const key = store.stableSourceId(clip);
		const img = await seedMedia("frame.png", 10);
		await store.saveMediaPool(key, [img.id]);
		await store.putTimeline(`seq:${key}`, { segments: [] });

		const inv = await loadStorageInventory();
		expect(inv.looseEdits).toHaveLength(1);
		const e = inv.looseEdits[0];
		expect(e.kind).toBe("pool");
		expect(e.mode).toBe("sequence");
		// The name was percent-encoded into the id and comes back readable.
		expect(e.label).toBe("my clip.mp4");
		expect(e.media.map((m) => m.name)).toEqual(["frame.png"]);
		expect(e.workSize).toBeGreaterThan(0);
	});

	test("attributes a proxy to its media and to the totals", async () => {
		const trackId = await seedTrack("t.wav", 10);
		const clip = await seedMedia("clip.mp4", 100);
		await store.saveMediaPool(trackId, [clip.id]);
		await store.putSequenceMediaProxy(clip.file, new Blob([bytes(30)]));

		const inv = await loadStorageInventory();
		expect(inv.proxyCount).toBe(1);
		expect(inv.totals.proxies).toBe(30);
		const m = inv.projects[0].media[0];
		expect(m.proxySize).toBe(30);
		// The project's media size is what deleting it would actually free.
		expect(inv.projects[0].mediaSize).toBe(130);
	});

	test("lists fonts with their stored size", async () => {
		fonts = [
			{
				id: "f1",
				name: "Rubik Glitch",
				family: '"Rubik Glitch"',
				sourceUrl: "",
				addedAt: 1,
			},
		];
		fontSizes = new Map([["f1", 4096]]);
		const inv = await loadStorageInventory();
		expect(inv.fonts).toEqual([{ id: "f1", name: "Rubik Glitch", size: 4096 }]);
		expect(inv.totals.fonts).toBe(4096);
	});

	test("orders projects most recently touched first", async () => {
		const older = await seedTrack("older.wav", 1);
		const newer = await seedTrack("newer.wav", 1);
		await store.putTimeline(`seq:${older}`, {});
		await new Promise((r) => setTimeout(r, 5));
		await store.putTimeline(`seq:${newer}`, {});
		const inv = await loadStorageInventory();
		expect(inv.projects.map((p) => p.name)).toEqual(["newer.wav", "older.wav"]);
	});
});

describe("deleteProject", () => {
	test("removes the song and every record keyed to it", async () => {
		const trackId = await seedTrack("song.wav", 10);
		const a = await seedMedia("a.png", 1);
		await store.saveMediaPool(trackId, [a.id]);
		await store.putTimeline(`seq:${trackId}`, {});
		await store.putTimeline(`single:${trackId}`, {});
		await store.putSession({
			key: `single:track:${trackId}`,
			mode: "single",
			label: "",
			trackId,
			sourceIds: [a.id],
			state: {},
		});
		await store.putSession({
			key: `slideshow:track:${trackId}`,
			mode: "slideshow",
			label: "",
			trackId,
			sourceIds: [a.id],
			state: {},
		});
		writeJson("openmosh-single-span", {
			[trackId]: { spanStart: 1, spanEnd: 2 },
			other: {},
		});
		writeJson("openmosh-track-segments", { [trackId]: { segments: [] } });
		writeJson("openmosh-render-settings", {
			[`seq:${trackId}`]: { w: 1 },
			[`single:${trackId}`]: { w: 2 },
			"seq:other": { w: 3 },
		});
		writeJson("openmosh-sequence", { [trackId]: { legacy: true } });

		const [project] = (await loadStorageInventory()).projects;
		await deleteProject(project);

		expect(await tracks.getAllTracks()).toEqual([]);
		expect(await store.getAllMediaPools()).toEqual([]);
		expect(await store.getAllTimelines()).toEqual([]);
		expect(await store.getAllSessions()).toEqual([]);
		expect(await idsInStore()).toEqual([]);
		expect(readJson("openmosh-single-span", {})).toEqual({ other: {} });
		expect(readJson("openmosh-track-segments", {})).toEqual({});
		expect(readJson("openmosh-render-settings", {})).toEqual({
			"seq:other": { w: 3 },
		});
		expect(readJson("openmosh-sequence", {})).toEqual({});
		expect((await loadStorageInventory()).projects).toEqual([]);
	});

	test("keeps blobs another project still points at", async () => {
		const t1 = await seedTrack("one.wav", 1);
		const t2 = await seedTrack("two.wav", 1);
		const shared = await seedMedia("shared.png", 1);
		const own = await seedMedia("own.png", 1);
		await store.saveMediaPool(t1, [shared.id, own.id]);
		await store.saveMediaPool(t2, [shared.id]);

		const inv = await loadStorageInventory();
		await deleteProject(inv.projects.find((p) => p.trackId === t1)!);

		expect(await idsInStore()).toEqual([shared.id]);
		const after = await loadStorageInventory();
		expect(after.projects.map((p) => p.trackId)).toEqual([t2]);
		expect(after.projects[0].media.map((m) => m.name)).toEqual(["shared.png"]);
	});

	test("keeps blobs a song-less edit still points at", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const img = await seedMedia("p.png", 1);
		await store.saveMediaPool(trackId, [img.id]);
		await store.putSession({
			key: `single:${img.id}`,
			mode: "single",
			label: "p.png",
			sourceIds: [img.id],
			state: {},
		});
		const [project] = (await loadStorageInventory()).projects;
		await deleteProject(project);
		expect(await idsInStore()).toEqual([img.id]);
	});

	test("takes the proxies of the blobs it drops", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const clip = await seedMedia("clip.mp4", 1);
		await store.saveMediaPool(trackId, [clip.id]);
		await store.putSequenceMediaProxy(clip.file, new Blob(["p"]));
		const [project] = (await loadStorageInventory()).projects;
		await deleteProject(project);
		expect(await store.getAllSequenceProxies()).toEqual([]);
	});

	test("leaves unassigned media alone", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const used = await seedMedia("used.png", 1);
		const stray = await seedMedia("stray.png", 1);
		await store.saveMediaPool(trackId, [used.id]);
		const [project] = (await loadStorageInventory()).projects;
		await deleteProject(project);
		expect(await idsInStore()).toEqual([stray.id]);
	});

	test("refreshes the upload screen's cached lists", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const a = await seedMedia("a.png", 1);
		await store.saveMediaPool(trackId, [a.id]);
		await store.putSession({
			key: `single:track:${trackId}`,
			mode: "single",
			label: "t.wav",
			trackId,
			sourceIds: [a.id],
			state: {},
		});
		writeJson("openmosh-saved-sequences", [
			{ trackId, trackName: "t.wav", sourceCount: 1, updatedAt: 1 },
		]);
		writeJson("openmosh-saved-sessions:single", [
			{
				key: `single:track:${trackId}`,
				mode: "single",
				label: "t.wav",
				sourceCount: 1,
				updatedAt: 1,
			},
		]);
		const [project] = (await loadStorageInventory()).projects;
		await deleteProject(project);
		expect(readJson("openmosh-saved-sequences", null)).toEqual([]);
		expect(readJson("openmosh-saved-sessions:single", null)).toEqual([]);
	});
});

describe("deleteLooseEdit", () => {
	test("a session goes with its media and render settings", async () => {
		const img = await seedMedia("photo.png", 1, 123);
		await store.putSession({
			key: `single:${img.id}`,
			mode: "single",
			label: "photo.png",
			sourceIds: [img.id],
			state: {},
		});
		// The editor keys these by the file with its name unencoded, not by the session.
		const renderKey = `single:file:photo.png:1:123`;
		writeJson("openmosh-render-settings", { [renderKey]: { w: 1 }, keep: {} });

		const [edit] = (await loadStorageInventory()).looseEdits;
		await deleteLooseEdit(edit);

		expect(await store.getAllSessions()).toEqual([]);
		expect(await idsInStore()).toEqual([]);
		expect(readJson("openmosh-render-settings", {})).toEqual({ keep: {} });
	});

	test("a pool goes with both of its timelines", async () => {
		const key = store.stableSourceId(mediaFile("clip.mp4", 5));
		const img = await seedMedia("frame.png", 1);
		await store.saveMediaPool(key, [img.id]);
		await store.putTimeline(`seq:${key}`, {});
		await store.putTimeline(`single:${key}`, {});
		await store.putTimeline("seq:unrelated", {});

		const [edit] = (await loadStorageInventory()).looseEdits;
		await deleteLooseEdit(edit);

		expect(await store.getAllMediaPools()).toEqual([]);
		expect((await store.getAllTimelines()).map((t) => t.key)).toEqual([
			"seq:unrelated",
		]);
		expect(await idsInStore()).toEqual([]);
	});

	test("keeps media a project shares with it", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const img = await seedMedia("p.png", 1);
		await store.saveMediaPool(trackId, [img.id]);
		await store.putSession({
			key: `single:${img.id}`,
			mode: "single",
			label: "p.png",
			sourceIds: [img.id],
			state: {},
		});
		const [edit] = (await loadStorageInventory()).looseEdits;
		await deleteLooseEdit(edit);
		expect(await idsInStore()).toEqual([img.id]);
	});
});

describe("deleteUnassignedMedia", () => {
	test("removes exactly the listed blobs and their proxies", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const used = await seedMedia("used.png", 1);
		const strayA = await seedMedia("a.png", 1);
		const strayB = await seedMedia("b.png", 1);
		await store.saveMediaPool(trackId, [used.id]);
		await store.putSequenceMediaProxy(strayA.file, new Blob(["p"]));
		await store.putSequenceMediaProxy(used.file, new Blob(["p"]));

		const inv = await loadStorageInventory();
		expect(inv.unassigned).toHaveLength(2);
		await deleteUnassignedMedia(inv.unassigned);

		expect(await idsInStore()).toEqual([used.id]);
		expect((await store.getAllSequenceProxies()).map((p) => p.id)).toEqual([
			used.id,
		]);
		expect(strayA.id).not.toBe(strayB.id);
	});

	test("won't drop a blob that gained a reference since the list was read", async () => {
		const stray = await seedMedia("a.png", 1);
		const inv = await loadStorageInventory();
		// A pool save lands between reading the list and clearing it.
		await store.saveMediaPool("late", [stray.id]);
		await deleteUnassignedMedia(inv.unassigned);
		expect(await idsInStore()).toEqual([stray.id]);
	});
});

describe("deleteAllProxies", () => {
	test("clears proxies and nothing else", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const clip = await seedMedia("clip.mp4", 1);
		await store.saveMediaPool(trackId, [clip.id]);
		await store.putSequenceMediaProxy(clip.file, new Blob(["p"]));

		await deleteAllProxies();

		expect(await store.getAllSequenceProxies()).toEqual([]);
		expect(await idsInStore()).toEqual([clip.id]);
		expect(await tracks.getAllTracks()).toHaveLength(1);
	});
});

describe("deleteEverything", () => {
	test("empties every store but leaves presets and settings", async () => {
		const trackId = await seedTrack("t.wav", 1);
		const img = await seedMedia("p.png", 1);
		await store.saveMediaPool(trackId, [img.id]);
		await store.putTimeline(`seq:${trackId}`, {});
		await store.putSession({
			key: `single:track:${trackId}`,
			mode: "single",
			label: "",
			trackId,
			sourceIds: [img.id],
			state: {},
		});
		await store.putSequenceMediaProxy(img.file, new Blob(["p"]));
		fonts = [{ id: "f", name: "F", family: "F", sourceUrl: "", addedAt: 1 }];
		fontSizes = new Map([["f", 1]]);
		writeJson("openmosh-track-segments", { [trackId]: {} });
		writeJson("openmosh-presets", [{ name: "mine" }]);
		writeJson("openmosh-settings", { moshMin: 2 });

		await deleteEverything();

		const inv = await loadStorageInventory();
		expect(inv.projects).toEqual([]);
		expect(inv.looseEdits).toEqual([]);
		expect(inv.unassigned).toEqual([]);
		expect(inv.proxyCount).toBe(0);
		expect(inv.fonts).toEqual([]);
		expect(readJson("openmosh-track-segments", null)).toEqual({});
		expect(readJson("openmosh-presets", null)).toEqual([{ name: "mine" }]);
		expect(readJson("openmosh-settings", null)).toEqual({ moshMin: 2 });
	});
});

describe("keepStorage", () => {
	test("reports false where the API is missing rather than throwing", async () => {
		expect(await inventory.keepStorage()).toBe(false);
	});
});
