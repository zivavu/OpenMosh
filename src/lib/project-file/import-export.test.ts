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
const { createMediaClip, createMediaLane } = await import("../media/types");
const { createAudioClip, createAudioLane } = await import("../mix/types");
const { createSourceEdit } = await import("../media/source-edit");
const { createTextClip, createTextLane } = await import("../text/types");
const { buildProjectFile } = await import("./export");
const { openProjectFile } = await import("./import");

import v0 from "../editor/fixtures/seq-entry/v0.json";
import v2 from "../editor/fixtures/seq-entry/v2.json";
import v3 from "../editor/fixtures/seq-entry/v3.json";

const OPENED = "opened-file";

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

describe("old projects", () => {
	const FIXTURES = { v0, v2, v3 } as unknown as Record<string, SeqEntry>;

	/** Source ids are remapped on import; blank them so the rest can be compared. */
	function blankSources(entry: ReturnType<typeof readSeqEntry>): unknown {
		const clone = structuredClone(entry) as {
			media?: {
				lanes: { sourceId: string | null; clips: { sourceId?: string }[] }[];
				audioLanes?: { clips: { sourceId: string | null }[] }[];
			};
			sourceEdits: Record<string, unknown>;
		};
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
