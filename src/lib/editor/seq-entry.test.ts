import { describe, expect, it } from "bun:test";
import {
	isNewerEntry,
	readSeqEntry,
	SEQ_ENTRY_VERSION,
	type SeqEntry,
} from "./seq-entry";
import { migrateLegacySegments } from "./legacy-segments";
import { normalizeFxLanes } from "./fx-lanes";
import { normalizeTextTimeline } from "../text/types";
import { normalizeMediaTimeline } from "../media/types";
import segmentsOnly from "./fixtures/seq-entry/v0-segments-only.json";
import v0 from "./fixtures/seq-entry/v0.json";
import v2 from "./fixtures/seq-entry/v2.json";
import v3 from "./fixtures/seq-entry/v3.json";
import v4 from "./fixtures/seq-entry/v4.json";

/** Entries as each version saved them, built with that version's own factories.
 * Never regenerate these: they stand for projects already on people's machines. */
const FIXTURES = { v0, v2, v3, v4 } as unknown as Record<string, SeqEntry>;
const OPENED = "opened-file";

describe.each(Object.entries(FIXTURES))("a %s entry", (_, entry) => {
	const restored = readSeqEntry(structuredClone(entry), OPENED);

	it("keeps its bpm, text and source edits", () => {
		expect(restored.bpm).toBe(128);
		// No version kept the first beat's offset before it existed.
		expect(restored.beatOffset).toBe(0);
		expect(restored.text?.lanes[0].clips.map((c) => c.text)).toEqual(["HELLO"]);
		expect(restored.sourceEdits["src-a"].chromaKey.enabled).toBe(true);
	});

	it("keeps its layer and the layer clip's chain", () => {
		const lane = restored.media!.lanes[0];
		expect(lane.sourceId).toBe("src-a");
		expect(lane.clips.map((c) => [c.start, c.end])).toEqual([[0, 8]]);
		const live = lane.clips[0].effects.filter((e) => e.enabled);
		expect(live.map((e) => e.defId)).toEqual(["posterize", "vhs"]);
	});

	it("keeps its fx lane", () => {
		expect(restored.fx.map((l) => l.name)).toEqual(["FX 1"]);
		const clip = restored.fx[0].clips[0];
		expect([clip.start, clip.end]).toEqual([2, 6]);
		expect(clip.effects.some((e) => e.defId === "pixelate" && e.enabled)).toBe(
			true,
		);
	});

	it("reads back the same once normalised", () => {
		expect(normalizeFxLanes(restored.fx)).toEqual(restored.fx);
		expect(normalizeTextTimeline(restored.text)).toEqual(restored.text!);
		expect(normalizeMediaTimeline(restored.media)).toEqual(restored.media!);
	});
});

describe("before v3", () => {
	it("sizes the project from its song", () => {
		for (const entry of [FIXTURES.v0, FIXTURES.v2]) {
			const restored = readSeqEntry(structuredClone(entry), OPENED);
			expect(restored.length).toBeNull();
			expect(restored.span).toBeNull();
		}
	});

	it("points unsourced v0 segments at the opened file, and folds them", () => {
		const restored = readSeqEntry(structuredClone(FIXTURES.v0), OPENED);
		expect(restored.segments.map((s) => s.sourceId)).toEqual([OPENED, OPENED]);
		const { fxLane, mediaLane } = migrateLegacySegments(restored.segments, 10);
		expect(fxLane?.clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[4, 10],
		]);
		expect(mediaLane?.clips.map((c) => c.sourceId)).toEqual([OPENED, OPENED]);
	});

	it("leaves v2 segments on the source they named", () => {
		const restored = readSeqEntry(structuredClone(FIXTURES.v2), OPENED);
		expect(restored.segments.map((s) => s.sourceId)).toEqual(["src-b"]);
	});

	it("opens an entry that holds nothing but segments", () => {
		const restored = readSeqEntry(
			structuredClone(segmentsOnly) as SeqEntry,
			OPENED,
		);
		expect(restored.bpm).toBe(0);
		expect(restored.fx).toEqual([]);
		expect(restored.text).toBeNull();
		expect(restored.media).toBeNull();
		expect(restored.segments).toHaveLength(2);
	});
});

describe.each([
	["v3", FIXTURES.v3],
	["v4", FIXTURES.v4],
])("%s", (_, entry) => {
	it("keeps its length, song and a span clamped to the length", () => {
		const restored = readSeqEntry(structuredClone(entry), OPENED);
		expect(restored.length).toBe(30);
		expect(restored.span).toEqual({ start: 2, end: 30 });
		expect(restored.song).toBe("song-1");
		expect(restored.segments).toEqual([]);
	});
});

describe("auto clips", () => {
	const enabledIn = (restored: ReturnType<typeof readSeqEntry>) =>
		restored.fx[0].clips[1].effects.filter((e) => e.enabled);

	it("from v4 keep their whole chain, which runs after the roll", () => {
		const restored = readSeqEntry(structuredClone(FIXTURES.v4), OPENED);
		expect(restored.fx[0].clips[1].mode).toBe("interval");
		expect(enabledIn(restored).map((e) => e.defId)).toEqual(["pixelate"]);
	});

	it("from before v4 keep only what they held through the roll", () => {
		const entry = structuredClone(FIXTURES.v4);
		entry.v = 3;
		const restored = readSeqEntry(structuredClone(entry), OPENED);
		expect(enabledIn(restored)).toEqual([]);

		entry.fx![0].clips[1].effects[0].locked = true;
		const locked = readSeqEntry(entry, OPENED);
		expect(enabledIn(locked).map((e) => e.defId)).toEqual(["pixelate"]);
	});

	it("leave static clips alone", () => {
		const restored = readSeqEntry(structuredClone(FIXTURES.v3), OPENED);
		const live = restored.fx[0].clips[0].effects.filter((e) => e.enabled);
		expect(live.map((e) => e.defId)).toEqual(["pixelate"]);
	});
});

describe("a damaged entry", () => {
	const damaged = {
		v: 3,
		length: 10,
		span: { start: 20, end: 30 },
		media: {
			enabled: true,
			lanes: [null, { clips: [null, 7] }],
			audioLanes: [null],
		},
		fx: [null, { clips: [null] }],
		text: { enabled: true, lanes: [null, { clips: [null] }] },
		segments: [null],
	} as unknown as SeqEntry;

	it("skips what isn't a record instead of throwing", () => {
		const restored = readSeqEntry(damaged, "opened");
		expect(restored.media?.lanes).toHaveLength(1);
		expect(restored.media?.lanes[0].clips).toEqual([]);
		expect(restored.media?.audioLanes).toEqual([]);
		expect(restored.fx).toHaveLength(1);
		expect(restored.text?.lanes).toHaveLength(1);
		expect(restored.segments).toEqual([]);
	});

	it("puts defaults where a clip's times aren't numbers", () => {
		const entry = structuredClone(FIXTURES.v4);
		const media = entry.media!;
		Object.assign(media.lanes[0].clips[0], {
			start: "0",
			end: null,
			sourceStart: {},
			fadeInSec: "1",
			gain: "loud",
		});
		Object.assign(entry.text!.lanes[0].clips[0], {
			start: [],
			fadeInSec: "2",
		});
		Object.assign(entry.fx![0].clips[0], { start: "x", end: true });
		media.audioLanes = [
			{
				id: "a",
				name: "Audio 1",
				enabled: true,
				clips: [
					{ id: "c", start: "1", end: 4, sourceStart: 0, sourceId: null },
				],
			},
		] as unknown as typeof media.audioLanes;
		const restored = readSeqEntry(entry, OPENED);
		const clip = restored.media!.lanes[0].clips[0];
		expect([clip.start, clip.end, clip.sourceStart]).toEqual([0, 0, 0]);
		expect(clip.fadeInSec).toBeUndefined();
		expect(clip.gain).toBeUndefined();
		const text = restored.text!.lanes[0].clips[0];
		expect(text.start).toBe(0);
		expect(text.fadeInSec).toBeUndefined();
		expect(restored.fx[0].clips[0].start).toBe(0);
		expect(restored.fx[0].clips[0].end).toBe(0);
		expect(restored.media!.audioLanes![0].clips[0].start).toBe(0);
	});

	it("drops a span that lies past the project's end", () => {
		expect(readSeqEntry(damaged, "opened").span).toBeNull();
		const partly = { ...damaged, span: { start: -2, end: 30 } };
		expect(readSeqEntry(partly, "opened").span).toEqual({ start: 0, end: 10 });
	});
});

describe("isNewerEntry", () => {
	it("is false for every version this build reads", () => {
		for (const entry of Object.values(FIXTURES)) {
			expect(isNewerEntry(entry)).toBe(false);
		}
		expect(isNewerEntry({ v: SEQ_ENTRY_VERSION })).toBe(false);
		expect(isNewerEntry(null)).toBe(false);
	});

	it("is true past the current version", () => {
		expect(isNewerEntry({ v: SEQ_ENTRY_VERSION + 1 })).toBe(true);
	});
});
