import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "bun:test";
import { addTrack, clearTracks } from "../audio/track-library";
import {
	clearAllSequenceStores,
	getTimeline,
	loadMediaPool,
	pruneSequenceMedia,
	putSequenceMedia,
	putSession,
	putTimeline,
	saveMediaPool,
	stableSourceId,
	storedMediaToFile,
	type StoredSequenceMedia,
} from "./sequence-media-store";

function makeFile(name: string, body: string, lastModified: number): File {
	return new File([body], name, { lastModified });
}

describe("stableSourceId", () => {
	test("is identical for the same file re-picked after a reload", () => {
		const a = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
		const b = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
		expect(stableSourceId(a)).toBe(stableSourceId(b));
	});

	test("differs on name, size or mtime", () => {
		const base = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
		const id = stableSourceId(base);
		expect(
			stableSourceId(makeFile("other.mp4", "abcdef", 1_700_000_000_000)),
		).not.toBe(id);
		expect(
			stableSourceId(makeFile("clip.mp4", "abcdefgh", 1_700_000_000_000)),
		).not.toBe(id);
		expect(
			stableSourceId(makeFile("clip.mp4", "abcdef", 1_700_000_000_001)),
		).not.toBe(id);
	});

	// A content-derived id must survive storage round-trips; File defaults
	// lastModified to Date.now(), so storedMediaToFile must carry it across.
	test("a stored record rebuilds to a File with the same id", () => {
		const file = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
		const id = stableSourceId(file);
		const record: StoredSequenceMedia = {
			id,
			name: file.name,
			blob: file,
			type: file.type,
			addedAt: Date.now(),
			lastModified: file.lastModified,
		};
		expect(stableSourceId(storedMediaToFile(record))).toBe(id);
	});

	test("records predating the lastModified field recover it from the id", () => {
		const file = makeFile("old.png", "xyz", 1_600_000_000_000);
		const id = stableSourceId(file);
		const legacy = {
			id,
			name: file.name,
			blob: file,
			type: file.type,
			addedAt: Date.now(),
		} as StoredSequenceMedia;
		expect(stableSourceId(storedMediaToFile(legacy))).toBe(id);
	});

	test("names containing the field separator stay distinct", () => {
		const a = makeFile("a:1:2.png", "x", 5);
		const b = makeFile("a_1_2.png", "x", 5);
		expect(stableSourceId(a)).not.toBe(stableSourceId(b));
		// A name shaped like "name:size:mtime" can't forge another file's id.
		expect(stableSourceId(makeFile("a.png:9:9", "x", 5))).not.toBe(
			stableSourceId(makeFile("a.png", "xxxxxxxxx", 9)),
		);
	});
});

describe("pruneSequenceMedia", () => {
	beforeEach(async () => {
		await clearAllSequenceStores();
		await clearTracks();
	});

	async function seedPool(key: string) {
		const file = makeFile(`${key}.png`, "x", 1);
		const id = stableSourceId(file);
		await putSequenceMedia([{ id, file }]);
		await saveMediaPool(key, [id]);
		return id;
	}

	test("a kept project keeps its timeline however many newer ones there are", async () => {
		const id = await seedPool("proj-old");
		await putTimeline("seq:proj-old", { v: 3 });
		for (let i = 0; i < 60; i++) {
			await putTimeline(`single:video:clip${i}.mp4:1:1`, { v: 3 });
		}
		await pruneSequenceMedia();
		expect(await loadMediaPool("proj-old")).toEqual([id]);
		expect(await getTimeline("seq:proj-old")).not.toBeNull();
	});

	test("a kept session keeps its timeline, keyed by song or by video", async () => {
		const video = makeFile("my clip.mp4", "v", 7);
		await putSequenceMedia([{ id: stableSourceId(video), file: video }]);
		await putSession({
			key: `single:${stableSourceId(video)}`,
			mode: "single",
			label: "my clip.mp4",
			sourceIds: [stableSourceId(video)],
			state: null,
		});
		const track = await addTrack(new File(["s"], "song.wav"));
		await putTimeline("single:video:my clip.mp4:1:7", { v: 3 });
		await putTimeline(`single:${track.id}`, { v: 3 });
		for (let i = 0; i < 60; i++) {
			await putTimeline(`single:video:clip${i}.mp4:1:1`, { v: 3 });
		}
		await pruneSequenceMedia();
		expect(await getTimeline("single:video:my clip.mp4:1:7")).not.toBeNull();
		expect(await getTimeline(`single:${track.id}`)).not.toBeNull();
	});

	test("timelines nothing keeps are dropped past the newest few", async () => {
		await putTimeline("single:video:oldest.mp4:1:1", { v: 3 });
		await new Promise((r) => setTimeout(r, 5));
		for (let i = 0; i < 20; i++) {
			await putTimeline(`single:video:clip${i}.mp4:1:1`, { v: 3 });
		}
		await pruneSequenceMedia();
		expect(await getTimeline("single:video:oldest.mp4:1:1")).toBeNull();
		const left = await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				getTimeline(`single:video:clip${i}.mp4:1:1`),
			),
		);
		expect(left.filter((t) => t !== null)).toHaveLength(8);
	});
});
