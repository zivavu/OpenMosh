import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeFontModule, fakeFonts, setFakeFonts } from "../testing/fake-fonts";

/** A project file round trip against the real IndexedDB stores on a fake database.
 * Only the font module is mocked (runes, bun can't evaluate). */

mock.module("../text-overlay/custom-fonts.svelte", fakeFontModule);

/** localStorage is absent under bun; the project-name store needs a stand-in. */
const localData = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => localData.get(k) ?? null,
	setItem: (k: string, v: string) => void localData.set(k, v),
	removeItem: (k: string) => void localData.delete(k),
};

const store = await import("../editor/sequence-media-store");
const tracks = await import("../audio/track-library");
const { readSeqEntry } = await import("../editor/seq-entry");
import type { SeqEntry } from "../editor/seq-entry";
const { readProjectNames, setProjectName } =
	await import("../editor/project-names");
const { loadRenderSettings, saveRenderSettings } =
	await import("../editor/render-settings");
const { createMediaClip, createMediaLane } = await import("../media/types");
const { createAudioClip, createAudioLane } = await import("../mix/types");
const { createSourceEdit } = await import("../media/source-edit");
const { createTextClip, createTextLane } = await import("../text/types");
const { buildProjectFile } = await import("./export");
const { findStoredCopy, readProjectFile, storeProjectFile } =
	await import("./import");
type ImportProgress = import("./import").ProjectImportProgress;
const { writeZip } = await import("./zip");

import v0 from "../editor/fixtures/seq-entry/v0.json";
import v2 from "../editor/fixtures/seq-entry/v2.json";
import v3 from "../editor/fixtures/seq-entry/v3.json";
import projectV1 from "./fixtures/v1.json";
import projectV2Single from "./fixtures/v2-single.json";
import projectV2Slideshow from "./fixtures/v2-slideshow.json";
import type { ProjectManifest } from "./manifest";

const PROJECT_FIXTURES = {
	v1: projectV1,
	"v2 single": projectV2Single,
	"v2 slideshow": projectV2Slideshow,
} as unknown as Record<string, ProjectManifest>;

const OPENED = "opened-file";

/** Import a file, returning where it landed. */
async function openProjectFile(
	blob: Blob,
	onProgress?: (p: ImportProgress) => void,
): Promise<string> {
	return (await storeProjectFile(await readProjectFile(blob), onProgress)).key;
}

function mediaFile(name: string, size: number, mtime: number): File {
	return new File([new Uint8Array(size).fill(7)], name, {
		type: "image/png",
		lastModified: mtime,
	});
}

async function seedMedia(name: string, size: number, mtime: number) {
	const file = mediaFile(name, size, mtime);
	const id = store.stableSourceId(file);
	await store.putSequenceMedia([{ id, file }]);
	return { id, file };
}

async function seedTrack(name: string, size: number) {
	const file = new File([new Uint8Array(size).fill(9)], name, {
		type: "audio/wav",
	});
	return (await tracks.addTrack(file)).id;
}

beforeEach(async () => {
	await store.clearAllSequenceStores();
	await tracks.clearTracks();
	localData.clear();
	setFakeFonts([]);
});

afterAll(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("a project file round trip", () => {
	test("brings back the timeline, pool order, song, name and fonts", async () => {
		const key = "proj-test";
		const a = await seedMedia("a.png", 100, 1000);
		const b = await seedMedia("b.png", 200, 2000);
		await store.saveMediaPool(key, [b.id, a.id]);
		const trackId = await seedTrack("song.wav", 500);
		setProjectName(key, "My project");

		const lane = createMediaLane("Layer 1", a.id);
		lane.clips = [createMediaClip(0, 8, 0, b.id)];
		const audio = createAudioLane("Audio 1");
		audio.clips = [createAudioClip(0, 8, `track:${trackId}`)];
		const textLane = createTextLane("Text 1");
		textLane.style = { ...textLane.style, fontFamily: "'My Font'" };
		textLane.clips = [createTextClip(0, 4, "HELLO")];
		const edit = createSourceEdit();
		edit.chromaKey.enabled = true;
		const entry: SeqEntry = {
			v: 3,
			bpm: 128,
			song: trackId,
			length: 30,
			span: { start: 0, end: 30 },
			media: { enabled: true, lanes: [lane], audioLanes: [audio] },
			text: { enabled: true, lanes: [textLane] },
			sourceEdits: { [a.id]: edit },
		};
		await store.putTimeline(`seq:${key}`, entry);
		setFakeFonts([
			{
				id: "f1",
				name: "My Font",
				family: "'My Font'",
				sourceUrl: "my-font.woff2",
				addedAt: 1,
				data: new TextEncoder().encode("FONT").buffer,
			},
		]);

		const built = await buildProjectFile(key);
		expect(built.missing).toBe(0);
		expect(built.name).toBe("My-project.openmosh");

		await store.clearAllSequenceStores();
		await tracks.clearTracks();
		localData.clear();
		setFakeFonts([]);

		const newKey = await openProjectFile(built.blob);
		expect(newKey.startsWith("proj-")).toBe(true);
		expect(newKey).not.toBe(key);

		const saved = (await store.getTimeline(`seq:${newKey}`)) as SeqEntry;
		const restored = readSeqEntry(saved, OPENED);
		expect(restored.bpm).toBe(128);
		expect(restored.length).toBe(30);
		expect(restored.span).toEqual({ start: 0, end: 30 });
		expect(restored.text?.lanes[0].clips[0].text).toBe("HELLO");
		expect(restored.text?.lanes[0].style.fontFamily).toBe("'My Font'");

		// The pool order survives, and the ids are the same stable ids as before.
		expect(await store.loadMediaPool(newKey)).toEqual([b.id, a.id]);
		expect(restored.media!.lanes[0].sourceId).toBe(a.id);
		expect(restored.media!.lanes[0].clips[0].sourceId).toBe(b.id);
		expect(Object.keys(restored.sourceEdits)).toEqual([a.id]);

		// The song is a fresh library entry, and the lane points at it.
		const newTracks = await tracks.getAllTracks();
		expect(newTracks).toHaveLength(1);
		expect(newTracks[0].blob.type).toBe("audio/wav");
		expect(restored.song).toBe(newTracks[0].id);
		expect(restored.media!.audioLanes![0].clips[0].sourceId).toBe(
			`track:${newTracks[0].id}`,
		);

		expect(readProjectNames()[newKey]).toBe("My project");
		expect(fakeFonts().map((f) => f.family)).toEqual(["'My Font'"]);
	});

	test("counts pool files whose bytes were gone", async () => {
		const key = "proj-missing";
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(key, [a.id, "src:gone.png:1:1"]);
		await store.putTimeline(`seq:${key}`, { v: 3, length: 10 });

		const built = await buildProjectFile(key);
		expect(built.missing).toBe(1);
	});

	test("counts songs that were deleted from the library", async () => {
		const key = "proj-no-song";
		const song = await seedTrack("song.wav", 50);
		await store.saveMediaPool(key, []);
		await store.putTimeline(`seq:${key}`, { v: 3, length: 10, song });
		await tracks.deleteTrack(song);

		const built = await buildProjectFile(key);
		expect(built.missing).toBe(1);
	});

	test("turns down a file damaged in transit, storing none of it", async () => {
		const key = "proj-damaged";
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(key, [a.id]);
		await store.putTimeline(`seq:${key}`, { v: 3, length: 10 });
		const bytes = new Uint8Array(
			await (await buildProjectFile(key)).blob.arrayBuffer(),
		);
		// One flipped byte inside the media's run of 7s.
		const media = bytes.findIndex((b, i) => b === 7 && bytes[i + 99] === 7);
		bytes[media + 50] ^= 0xff;

		await store.clearAllSequenceStores();
		await expect(openProjectFile(new Blob([bytes]))).rejects.toThrow(
			"That project file is damaged",
		);
		expect((await store.getAllSequenceMediaIds()).size).toBe(0);
	});

	test("reports the check rising to a whole file, then the store", async () => {
		const key = "proj-progress";
		const a = await seedMedia("a.png", 100, 1000);
		const b = await seedMedia("b.png", 200, 2000);
		await store.saveMediaPool(key, [a.id, b.id]);
		await store.putTimeline(`seq:${key}`, { v: 3, length: 10 });
		const built = await buildProjectFile(key);
		await store.clearAllSequenceStores();

		const seen: { stage: string; fraction?: number }[] = [];
		await openProjectFile(built.blob, (p) => seen.push({ ...p }));

		const fractions = seen.flatMap((p) =>
			p.stage === "checking" ? [p.fraction!] : [],
		);
		expect(fractions[0]).toBe(0);
		expect(fractions.at(-1)).toBe(1);
		expect(fractions).toEqual([...fractions].sort((x, y) => x - y));
		expect(seen.at(-1)).toEqual({ stage: "storing" });
	});

	test("finds the stored project a file is an unchanged copy of", async () => {
		const key = "proj-same";
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(key, [a.id]);
		const trackId = await seedTrack("song.wav", 500);
		const lane = createMediaLane("Layer 1", a.id);
		lane.clips = [createMediaClip(0, 8, 0, a.id)];
		await store.putTimeline(`seq:${key}`, {
			v: 3,
			song: trackId,
			length: 10,
			media: { enabled: true, lanes: [lane], audioLanes: [] },
		});
		setProjectName(key, "Same");
		const built = await buildProjectFile(key);

		const copy = await findStoredCopy(await readProjectFile(built.blob));
		expect(copy).toEqual({ mode: "sequence", key, name: "Same" });

		// What an import stores is found as the same project the next time.
		const imported = await openProjectFile(built.blob);
		await store.deleteMediaPool(key);
		const again = await findStoredCopy(await readProjectFile(built.blob));
		expect(again?.key).toBe(imported);
	});

	test("finds no copy once the stored project has changed", async () => {
		const key = "proj-changed";
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(key, [a.id]);
		await store.putTimeline(`seq:${key}`, { v: 3, length: 10 });
		const built = await buildProjectFile(key);
		await store.putTimeline(`seq:${key}`, { v: 3, length: 12 });

		expect(await findStoredCopy(await readProjectFile(built.blob))).toBeNull();
	});

	test("finds no copy when the song isn't in the library", async () => {
		const key = "proj-songless";
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(key, [a.id]);
		const trackId = await seedTrack("song.wav", 500);
		await store.putTimeline(`seq:${key}`, { v: 3, song: trackId, length: 10 });
		const built = await buildProjectFile(key);
		await tracks.clearTracks();

		expect(await findStoredCopy(await readProjectFile(built.blob))).toBeNull();
	});

	test("names the song of a project keyed by it", async () => {
		const trackId = await seedTrack("song.wav", 500);
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(trackId, [a.id]);
		await store.putTimeline(`seq:${trackId}`, structuredClone(v2));

		const built = await buildProjectFile(trackId);
		await tracks.clearTracks();
		const newKey = await openProjectFile(built.blob);

		const saved = (await store.getTimeline(`seq:${newKey}`)) as SeqEntry;
		const [song] = await tracks.getAllTracks();
		expect(saved.song).toBe(song.id);
	});

	test("saves the open editor's pool, not the stored one", async () => {
		const key = "proj-live";
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(key, [a.id]);
		const fresh = mediaFile("fresh.png", 300, 3000);
		const freshId = store.stableSourceId(fresh);

		const built = await buildProjectFile(key, {
			live: {
				mode: "sequence",
				entry: { v: 3, length: 10 },
				media: [
					{ id: a.id, file: mediaFile("a.png", 100, 1000) },
					{ id: freshId, file: fresh },
				],
			},
		});
		const newKey = await openProjectFile(built.blob);
		expect(await store.loadMediaPool(newKey)).toEqual([a.id, freshId]);
	});

	test("brings back the output size, fps and take length", async () => {
		const key = "proj-render";
		await store.putTimeline(`seq:${key}`, { v: 3, length: 10 });
		const render = { fps: 24, duration: 12, width: 1080, height: 1920 };
		saveRenderSettings(`seq:${key}`, render);

		const built = await buildProjectFile(key);
		localData.clear();
		const newKey = await openProjectFile(built.blob);
		expect(loadRenderSettings(`seq:${newKey}`)).toEqual(render);
	});

	test("names a copy when the name is taken", async () => {
		const key = "proj-name";
		const a = await seedMedia("a.png", 100, 1000);
		await store.saveMediaPool(key, [a.id]);
		await store.putTimeline(`seq:${key}`, { v: 3, length: 10 });
		setProjectName(key, "Shared name");

		const built = await buildProjectFile(key);
		const newKey = await openProjectFile(built.blob);
		expect(readProjectNames()[newKey]).toBe("Shared name (copy)");
	});
});

describe("single and slideshow edits", () => {
	async function seedSingle() {
		const key = "single:p:test";
		const a = await seedMedia("clip.mp4", 300, 3000);
		const trackId = await seedTrack("beat.wav", 400);
		const text = createTextLane("Text 1");
		text.clips = [createTextClip(0, 2, "HI")];
		const state = {
			effects: [
				{
					instanceId: "fx-1",
					defId: "rgbShift",
					enabled: true,
					locked: false,
					expanded: false,
					values: { amount: 0.4 },
				},
			],
			text: { enabled: true, lanes: [text] },
		};
		await store.putSession({
			key,
			mode: "single",
			label: "clip.mp4",
			trackId,
			sourceIds: [a.id],
			state,
		});
		await store.putTimeline(key, { v: 4, song: trackId, sourceEdits: {} });
		saveRenderSettings(key, { fps: 25, duration: 6 });
		setProjectName(key, "My single");
		return { key, a, trackId, state };
	}

	test("a single edit comes back as a single edit", async () => {
		const { key, a, state } = await seedSingle();
		const built = await buildProjectFile(key, { mode: "single" });
		expect(built.name).toBe("My-single.openmosh-single");
		await store.clearAllSequenceStores();
		await tracks.clearTracks();
		localData.clear();

		const landed = await storeProjectFile(await readProjectFile(built.blob));
		expect(landed.mode).toBe("single");
		expect(landed.key.startsWith("single:p:")).toBe(true);
		const session = await store.getSession(landed.key);
		const [song] = await tracks.getAllTracks();
		expect(session?.mode).toBe("single");
		expect(session?.sourceIds).toEqual([a.id]);
		expect(session?.trackId).toBe(song.id);
		expect(session?.state).toEqual(state);
		expect(await store.getTimeline(landed.key)).toMatchObject({
			song: song.id,
		});
		expect(loadRenderSettings(landed.key)).toEqual({ fps: 25, duration: 6 });
		expect(readProjectNames()[landed.key]).toBe("My single");
	});

	test("a slideshow comes back with its slides in order and its song", async () => {
		const key = "slideshow:p:test";
		const a = await seedMedia("one.png", 100, 1000);
		const b = await seedMedia("two.png", 200, 2000);
		const trackId = await seedTrack("song.wav", 500);
		const config = {
			bpm: 140,
			beatOffset: 0.2,
			subdivision: 0.5,
			moshMode: "smooth",
			moshMin: 1,
			moshMax: 4,
			smoothSpeed: 2,
			moshAudioLink: true,
			moshAudioLinkStrength: 0.5,
			segments: [{ id: "seg-1", startTime: 4, subdivision: 1 }],
			text: { enabled: false, lanes: [] },
			span: { start: 2, end: 9 },
		};
		await store.putSession({
			key,
			mode: "slideshow",
			label: "song.wav",
			trackId,
			sourceIds: [b.id, a.id],
			state: { config },
		});
		saveRenderSettings(`slideshow:${trackId}`, { width: 1080, height: 1080 });
		const built = await buildProjectFile(key, { mode: "slideshow" });
		expect(built.name).toBe("song.wav.openmosh-slideshow");
		await store.clearAllSequenceStores();
		await tracks.clearTracks();
		localData.clear();

		const landed = await storeProjectFile(await readProjectFile(built.blob));
		expect(landed.mode).toBe("slideshow");
		const session = await store.getSession(landed.key);
		const [song] = await tracks.getAllTracks();
		expect(session?.sourceIds).toEqual([b.id, a.id]);
		expect(session?.trackId).toBe(song.id);
		expect(session?.state).toEqual({ config });
		expect(loadRenderSettings(landed.key)).toEqual({
			width: 1080,
			height: 1080,
		});
		// Another slideshow on the same song keeps its own.
		expect(loadRenderSettings(`slideshow:${song.id}`)).toBeNull();
	});

	test("an unchanged single edit is found as a copy, and an edited one isn't", async () => {
		const { key } = await seedSingle();
		const built = await buildProjectFile(key, { mode: "single" });
		const read = await readProjectFile(built.blob);
		expect(await findStoredCopy(read)).toEqual({
			mode: "single",
			key,
			name: "My single",
		});

		const session = (await store.getSession(key))!;
		await store.putSession({ ...session, state: { effects: [], text: null } });
		expect(await findStoredCopy(read)).toBeNull();
	});

	test("an editor project is never taken for a copy of a single edit", async () => {
		const { key } = await seedSingle();
		const built = await buildProjectFile(key, { mode: "single" });
		await store.deleteSession(key);
		await store.saveMediaPool("proj-other", [
			(await seedMedia("clip.mp4", 300, 3000)).id,
		]);
		await store.putTimeline("seq:proj-other", { v: 4, sourceEdits: {} });
		expect(await findStoredCopy(await readProjectFile(built.blob))).toBeNull();
	});
});

describe("project files from every past version", () => {
	/** Wrap a stored manifest in a zip, with bytes at every path it names. */
	async function zipOf(manifest: ProjectManifest): Promise<Blob> {
		const paths = [...manifest.pool, ...manifest.songs, ...manifest.fonts]
			.map((item) => item.path)
			.filter((path): path is string => !!path);
		return writeZip([
			{ name: "project.json", blob: new Blob([JSON.stringify(manifest)]) },
			...paths.map((name) => ({ name, blob: new Blob([name]) })),
		]);
	}

	test.each(Object.entries(PROJECT_FIXTURES))(
		"a %s file opens in the mode it was saved from",
		async (_, fixture) => {
			const landed = await storeProjectFile(
				await readProjectFile(await zipOf(fixture)),
			);
			const mode = fixture.mode ?? "sequence";
			expect(landed.mode).toBe(mode);
			expect(readProjectNames()[landed.key]).toBe(fixture.name);
			if (mode === "sequence") {
				expect(await store.loadMediaPool(landed.key)).toHaveLength(
					fixture.pool.length,
				);
				const saved = await store.getTimeline(`seq:${landed.key}`);
				expect(saved).toMatchObject({ v: fixture.entry!.v });
			} else {
				const session = await store.getSession(landed.key);
				expect(session?.sourceIds).toHaveLength(fixture.pool.length);
				expect(session?.trackId).toBeTruthy();
			}
		},
	);
});

describe("old projects", () => {
	const FIXTURES = { v0, v2, v3 } as unknown as Record<string, SeqEntry>;

	/** Source ids are remapped on import; blank them so the rest can be compared. */
	function blankSources(entry: ReturnType<typeof readSeqEntry>): unknown {
		const clone = structuredClone(entry) as {
			media?: {
				lanes: { sourceId: string | null; clips: { sourceId?: string }[] }[];
				audioLanes?: { clips: { sourceId: string | null }[] }[];
			};
			// Swapped for a list below: only how many edits there were is compared.
			sourceEdits: Record<string, unknown> | string[];
			segments: { sourceId?: unknown }[];
		};
		for (const seg of clone.segments) seg.sourceId = "src";
		for (const lane of clone.media?.lanes ?? []) {
			lane.sourceId = null;
			for (const clip of lane.clips) delete clip.sourceId;
		}
		for (const lane of clone.media?.audioLanes ?? []) {
			for (const clip of lane.clips) clip.sourceId = null;
		}
		clone.sourceEdits = Object.keys(clone.sourceEdits).map(() => "src");
		return clone;
	}

	/** Effect instance ids are minted fresh on every read; drop them from the compare. */
	function strip(value: unknown): string {
		return JSON.stringify(value, (key, v) =>
			key === "instanceId" ? undefined : v,
		);
	}

	test.each(Object.entries(FIXTURES))(
		"a %s entry survives export and import",
		async (_, fixture) => {
			const key = "proj-old";
			await store.putSequenceMedia([
				{ id: "src-a", file: mediaFile("a.png", 100, 1000) },
				{ id: "src-b", file: mediaFile("b.png", 200, 2000) },
			]);
			await store.saveMediaPool(key, ["src-a", "src-b"]);
			await store.putTimeline(`seq:${key}`, structuredClone(fixture));

			const built = await buildProjectFile(key);
			await store.clearAllSequenceStores();
			await tracks.clearTracks();
			localData.clear();

			const newKey = await openProjectFile(built.blob);
			const saved = (await store.getTimeline(`seq:${newKey}`)) as SeqEntry;
			const restored = readSeqEntry(saved, OPENED);
			const expected = readSeqEntry(structuredClone(fixture), OPENED);

			expect(strip(blankSources(restored))).toBe(strip(blankSources(expected)));
			// The pool came back in order, remapped onto the stable ids.
			expect(await store.loadMediaPool(newKey)).toEqual([
				store.stableSourceId(mediaFile("a.png", 100, 1000)),
				store.stableSourceId(mediaFile("b.png", 200, 2000)),
			]);
		},
	);
});

describe("fonts in a project file", () => {
	async function fileWithFonts(fonts: unknown[]): Promise<Blob> {
		const manifest = {
			format: "openmosh-project",
			version: 1,
			name: "Fonts",
			entry: { v: 3, length: 10 },
			pool: [],
			songs: [],
			fonts,
		};
		return writeZip([
			{ name: "project.json", blob: new Blob([JSON.stringify(manifest)]) },
		]);
	}

	test("a link to any other site is never fetched on import", async () => {
		await openProjectFile(
			await fileWithFonts([
				{ id: "a", family: "'Evil'", url: "https://evil.example/x.woff2" },
				{ id: "b", family: "'Local'", url: "http://192.168.0.1/x.ttf" },
			]),
		);
		expect(fakeFonts()).toEqual([]);
	});

	test("a Google Fonts link from an older file still comes back", async () => {
		await openProjectFile(
			await fileWithFonts([
				{
					id: "g",
					family: "'Rubik Glitch'",
					url: "https://fonts.googleapis.com/css2?family=Rubik+Glitch",
				},
			]),
		);
		expect(fakeFonts()).toHaveLength(1);
	});

	test("a font added from a link is saved into the file as bytes", async () => {
		const key = "proj-font";
		const textLane = createTextLane("Text", 0);
		textLane.style = { ...textLane.style, fontFamily: "'Linked'" };
		await store.putTimeline(`seq:${key}`, {
			v: 3,
			length: 10,
			text: { enabled: true, lanes: [textLane] },
		});
		setFakeFonts([
			{
				id: "l1",
				name: "Linked",
				family: "'Linked'",
				sourceUrl: "https://fonts.googleapis.com/css2?family=Linked",
				addedAt: 1,
				data: new TextEncoder().encode("FONT").buffer,
			},
		]);
		const built = await buildProjectFile(key);
		setFakeFonts([]);
		await openProjectFile(built.blob);
		expect(fakeFonts().map((f) => f.sourceUrl)).toEqual(["fonts/l1.woff2"]);
	});
});
