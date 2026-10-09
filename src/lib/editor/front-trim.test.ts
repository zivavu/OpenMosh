import { describe, expect, it } from "bun:test";
import {
	moveProjectStart,
	opensProject,
	type ProjectTimelines,
} from "./front-trim";
import type { AudioClip } from "../mix/types";
import type { MediaClip, MediaTimeline } from "../media/types";

const song: AudioClip = {
	id: "song",
	start: 0,
	end: 100,
	sourceStart: 10,
	sourceId: "track:abc",
};

function project(): ProjectTimelines {
	const media = {
		enabled: true,
		lanes: [
			{
				id: "l1",
				sourceId: "video",
				clips: [
					{ id: "a", start: 2, end: 8, sourceStart: 1 },
					{ id: "b", start: 20, end: 30, sourceStart: 0, speed: 2 },
				] as MediaClip[],
			},
		],
		audioLanes: [
			{ id: "al", name: "Audio 1", enabled: true, drives: true, clips: [song] },
		],
	} as unknown as MediaTimeline;
	return {
		media,
		text: {
			enabled: true,
			lanes: [{ clips: [{ id: "t", start: 40, end: 50 }] }],
		} as unknown as ProjectTimelines["text"],
		fx: [
			{ clips: [{ id: "f", start: 5, end: 25 }] },
		] as unknown as ProjectTimelines["fx"],
		length: 100,
	};
}

const clip = (p: ProjectTimelines, id: string) =>
	[
		...p.media.lanes.flatMap((l) => l.clips),
		...(p.media.audioLanes ?? []).flatMap((l) => l.clips),
		...p.text.lanes.flatMap((l) => l.clips),
		...p.fx.flatMap((l) => l.clips),
	].find((c) => c.id === id) as (MediaClip & AudioClip) | undefined;

describe("moveProjectStart", () => {
	it("reaches back into the song's intro and pushes everything later", () => {
		const p = moveProjectStart(project(), "song", -4, 600);
		expect(p.length).toBe(104);
		expect(clip(p, "song")).toMatchObject({
			start: 0,
			end: 104,
			sourceStart: 6,
		});
		expect(clip(p, "a")).toMatchObject({ start: 6, end: 12, sourceStart: 1 });
		expect(clip(p, "t")).toMatchObject({ start: 44, end: 54 });
	});

	it("leaves silence before the song once its intro runs out", () => {
		const p = moveProjectStart(project(), "song", -15, 600);
		expect(p.length).toBe(115);
		expect(clip(p, "song")).toMatchObject({
			start: 5,
			end: 115,
			sourceStart: 0,
		});
	});

	it("cuts the front off, carrying cut clips' media on", () => {
		const p = moveProjectStart(project(), "song", 22, 600);
		expect(p.length).toBe(78);
		expect(clip(p, "song")).toMatchObject({
			start: 0,
			end: 78,
			sourceStart: 32,
		});
		expect(clip(p, "a")).toBeUndefined();
		// Two seconds in at double speed: four seconds of its video gone.
		expect(clip(p, "b")).toMatchObject({ start: 0, end: 8, sourceStart: 4 });
		expect(clip(p, "f")).toMatchObject({ start: 0, end: 3 });
	});

	it("keeps within the longest project and the song's own length", () => {
		expect(moveProjectStart(project(), "song", -50, 120).length).toBe(120);
		expect(moveProjectStart(project(), "song", 500, 600).length).toBeCloseTo(1);
	});
});

describe("opensProject", () => {
	it("is a library song at the very start", () => {
		expect(opensProject(song)).toBe(true);
		expect(opensProject({ ...song, start: 3 })).toBe(false);
		expect(opensProject({ ...song, sourceId: "video" })).toBe(false);
	});
});
