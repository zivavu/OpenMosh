import { describe, expect, it } from "bun:test";
import { createAudioClip, createAudioLane } from "../mix/types";
import { createMediaClip, createMediaLane } from "../media/types";
import { createSourceEdit } from "../media/source-edit";
import { SEQ_ENTRY_VERSION, type SeqEntry } from "../editor/seq-entry";
import {
	parseManifest,
	projectFileModeOf,
	PROJECT_FORMAT,
	PROJECT_VERSION,
	remapProject,
} from "./manifest";

function validManifest() {
	return {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		app: "0.9.5",
		savedAt: 1_700_000_000_000,
		name: "My project",
		entry: { v: 3 },
		pool: [
			{
				id: "src-a",
				name: "a.png",
				type: "image/png",
				lastModified: 1,
				path: "media/0.png",
			},
		],
		songs: [
			{
				trackId: "song-1",
				name: "song.wav",
				fileName: "song.wav",
				path: "songs/0.wav",
			},
		],
		fonts: [
			{ id: "f1", family: "'Rubik Glitch'", url: "https://fonts.google.com/x" },
		],
	};
}

describe("parseManifest", () => {
	it("reads a valid manifest", () => {
		const m = parseManifest(validManifest());
		expect(m.name).toBe("My project");
		expect(m.pool[0].path).toBe("media/0.png");
		expect(m.songs[0].trackId).toBe("song-1");
		expect(m.fonts[0].url).toBe("https://fonts.google.com/x");
	});

	it("keeps a song's take mark, and only a true one", () => {
		const raw = validManifest();
		const songs = [
			{ ...raw.songs[0], take: true },
			{ ...raw.songs[0], trackId: "song-2", take: "yes" },
		];
		const m = parseManifest({ ...raw, songs });
		expect(m.songs[0].take).toBe(true);
		expect(m.songs[1].take).toBeUndefined();
	});

	it("keeps only usable render settings", () => {
		const m = parseManifest({
			...validManifest(),
			render: { fps: 30, width: -5, height: "1080", duration: Infinity },
		});
		expect(m.render).toEqual({ fps: 30 });
		expect(parseManifest(validManifest()).render).toBeUndefined();
	});

	it("rejects a file that isn't an OpenMosh project", () => {
		expect(() => parseManifest({ format: "something-else" })).toThrow(
			"That isn't an OpenMosh project file",
		);
		expect(() => parseManifest(null)).toThrow(
			"That isn't an OpenMosh project file",
		);
	});

	it("rejects a newer file version", () => {
		expect(() =>
			parseManifest({ ...validManifest(), version: PROJECT_VERSION + 1 }),
		).toThrow("Made by a newer OpenMosh; update and try again");
	});

	it("rejects a timeline saved by a newer OpenMosh", () => {
		expect(() =>
			parseManifest({
				...validManifest(),
				entry: { v: SEQ_ENTRY_VERSION + 1 },
			}),
		).toThrow("Made by a newer OpenMosh; update and try again");
	});

	it("rejects a path that climbs out of the zip", () => {
		const manifest = validManifest();
		manifest.pool[0].path = "media/../../etc/passwd";
		expect(() => parseManifest(manifest)).toThrow(
			"That project file points outside itself",
		);
	});

	it("rejects an absolute path", () => {
		const manifest = validManifest();
		manifest.songs[0].path = "/songs/0.wav";
		expect(() => parseManifest(manifest)).toThrow(
			"That project file points outside itself",
		);
	});

	it("rejects a file in the wrong folder", () => {
		const manifest = validManifest();
		manifest.pool[0].path = "songs/0.png";
		expect(() => parseManifest(manifest)).toThrow(
			"That project file has a file in the wrong place",
		);
	});
});

describe("parseManifest on single and slideshow edits", () => {
	it("reads a file with no mode as an editor project", () => {
		const m = parseManifest({ ...validManifest(), version: 1 });
		expect(m.mode).toBe("sequence");
		expect(m.state).toBeUndefined();
	});

	it("rejects a mode it doesn't know", () => {
		expect(() =>
			parseManifest({ ...validManifest(), mode: "collage" }),
		).toThrow("Made by a newer OpenMosh; update and try again");
	});

	it("still needs a timeline for an editor project, but not for a slideshow", () => {
		const { entry: _, ...noEntry } = validManifest();
		expect(() => parseManifest(noEntry)).toThrow(
			"That project file has no timeline",
		);
		const m = parseManifest({ ...noEntry, mode: "slideshow", state: {} });
		expect(m.entry).toBeNull();
	});

	it("keeps a single edit's effects and text, and a song it names", () => {
		const m = parseManifest({
			...validManifest(),
			mode: "single",
			trackId: "song-1",
			state: { effects: [{ defId: "x" }, 5, null], text: "nope" },
		});
		expect(m.state).toEqual({ effects: [{ defId: "x" }], text: null });
		expect(m.trackId).toBe("song-1");
	});

	it("keeps only slideshow settings of the type they should be", () => {
		const m = parseManifest({
			...validManifest(),
			mode: "slideshow",
			state: {
				config: {
					bpm: "fast",
					beatOffset: Infinity,
					moshMode: "smooth",
					moshAudioLink: true,
					smoothSpeed: 3,
					segments: [
						{ id: "a", startTime: 2, subdivision: 1 },
						{ id: "b", startTime: "later" },
						{ startTime: 1 },
					],
					text: [],
					extra: 1,
				},
			},
		});
		expect(m.state).toEqual({
			config: {
				moshMode: "smooth",
				moshAudioLink: true,
				smoothSpeed: 3,
				segments: [{ id: "a", startTime: 2, subdivision: 1 }],
			},
		});
		expect(m.entry).toBeNull();
	});
});

describe("projectFileModeOf", () => {
	it("reads each mode's extension, whatever its case", () => {
		expect(projectFileModeOf("a.openmosh")).toBe("sequence");
		expect(projectFileModeOf("a.OpenMosh-Single")).toBe("single");
		expect(projectFileModeOf("a.openmosh-slideshow")).toBe("slideshow");
	});

	it("knows no other file, a backup included", () => {
		expect(projectFileModeOf("a.openmosh-backup")).toBeNull();
		expect(projectFileModeOf("a.zip")).toBeNull();
	});
});

describe("remapProject", () => {
	function entry(): SeqEntry {
		const lane = createMediaLane("Layer 1", "src-a");
		lane.clips = [createMediaClip(0, 1, 0, "src-b")];
		const audio = createAudioLane("Audio 1");
		audio.clips = [createAudioClip(0, 1, "track:old-song")];
		return {
			v: 3,
			song: "old-song",
			bpmSource: "src-b",
			media: { enabled: true, lanes: [lane], audioLanes: [audio] },
			sourceEdits: { "src-a": createSourceEdit() },
		};
	}

	it("rewrites the song, every source and the edit keys", () => {
		const out = remapProject(
			entry(),
			new Map([["old-song", "new-song"]]),
			new Map([
				["src-a", "src:new-a"],
				["src-b", "src:new-b"],
			]),
		);
		expect(out.song).toBe("new-song");
		expect(out.bpmSource).toBe("src:new-b");
		expect(out.media!.lanes[0].sourceId).toBe("src:new-a");
		expect(out.media!.lanes[0].clips[0].sourceId).toBe("src:new-b");
		expect(out.media!.audioLanes![0].clips[0].sourceId).toBe("track:new-song");
		expect(Object.keys(out.sourceEdits!)).toEqual(["src:new-a"]);
	});

	it("leaves ids with no mapping alone", () => {
		const out = remapProject(entry(), new Map(), new Map());
		expect(out.song).toBe("old-song");
		expect(out.media!.lanes[0].sourceId).toBe("src-a");
		expect(out.media!.lanes[0].clips[0].sourceId).toBe("src-b");
		expect(out.media!.audioLanes![0].clips[0].sourceId).toBe("track:old-song");
		expect(Object.keys(out.sourceEdits!)).toEqual(["src-a"]);
	});

	it("doesn't mutate the entry it was given", () => {
		const original = entry();
		remapProject(
			original,
			new Map([["old-song", "new-song"]]),
			new Map([["src-a", "src:new-a"]]),
		);
		expect(original.song).toBe("old-song");
		expect(original.media!.lanes[0].sourceId).toBe("src-a");
	});
});

describe("remapProject on a damaged or old entry", () => {
	it("doesn't throw on media without lanes", () => {
		const out = remapProject(
			{ v: 3, media: {} } as unknown as SeqEntry,
			new Map(),
			new Map(),
		);
		expect(out.media?.lanes).toEqual([]);
	});

	it("remaps the media ids an old entry's segments point at", () => {
		const out = remapProject(
			{ segments: [{ sourceId: "old" }, null] } as unknown as SeqEntry,
			new Map(),
			new Map([["old", "new"]]),
		);
		expect(out.segments).toEqual([{ sourceId: "new" }]);
	});
});
