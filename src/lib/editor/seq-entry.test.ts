import { describe, expect, it } from "bun:test";
import { readSeqEntry, type SeqEntry } from "./seq-entry";
import { migrateLegacySegments } from "./legacy-segments";
import { normalizeFxLanes } from "./fx-lanes";
import { normalizeTextTimeline } from "../text/types";
import { normalizeMediaTimeline } from "../media/types";
import segmentsOnly from "./fixtures/seq-entry/v0-segments-only.json";
import v0 from "./fixtures/seq-entry/v0.json";
import v2 from "./fixtures/seq-entry/v2.json";
import v3 from "./fixtures/seq-entry/v3.json";

/** Entries as each version saved them, built with that version's own factories.
 * Never regenerate these: they stand for projects already on people's machines. */
const FIXTURES = { v0, v2, v3 } as unknown as Record<string, SeqEntry>;
const OPENED = "opened-file";

describe.each(Object.entries(FIXTURES))("a %s entry", (_, entry) => {
	const restored = readSeqEntry(structuredClone(entry), OPENED);

	it("keeps its bpm, text and source edits", () => {
		expect(restored.bpm).toBe(128);
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
		for (const entry of [v0, v2] as SeqEntry[]) {
			const restored = readSeqEntry(structuredClone(entry), OPENED);
			expect(restored.length).toBeNull();
			expect(restored.span).toBeNull();
		}
	});

	it("points unsourced v0 segments at the opened file, and folds them", () => {
		const restored = readSeqEntry(structuredClone(v0) as SeqEntry, OPENED);
		expect(restored.segments.map((s) => s.sourceId)).toEqual([OPENED, OPENED]);
		const { fxLane, mediaLane } = migrateLegacySegments(restored.segments, 10);
		expect(fxLane?.clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[4, 10],
		]);
		expect(mediaLane?.clips.map((c) => c.sourceId)).toEqual([OPENED, OPENED]);
	});

	it("leaves v2 segments on the source they named", () => {
		const restored = readSeqEntry(structuredClone(v2) as SeqEntry, OPENED);
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

describe("v3", () => {
	it("keeps its length, song and a span clamped to the length", () => {
		const restored = readSeqEntry(structuredClone(v3) as SeqEntry, OPENED);
		expect(restored.length).toBe(30);
		expect(restored.span).toEqual({ start: 2, end: 30 });
		expect(restored.song).toBe("song-1");
		expect(restored.segments).toEqual([]);
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

	it("drops a span that lies past the project's end", () => {
		expect(readSeqEntry(damaged, "opened").span).toBeNull();
		const partly = { ...damaged, span: { start: -2, end: 30 } };
		expect(readSeqEntry(partly, "opened").span).toEqual({ start: 0, end: 10 });
	});
});
