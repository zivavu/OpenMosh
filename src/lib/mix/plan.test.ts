import { describe, expect, it } from "bun:test";
import {
	createMediaClip,
	createMediaLane,
	type MediaTimeline,
} from "../media/types";
import { createSourceEdit } from "../media/source-edit";
import { planMix, segmentEnvelope, trimSegment } from "./plan";
import { createAudioClip, createAudioLane, trackSourceId } from "./types";

function videoTimeline(
	clips: [number, number, number?][],
	audio = { muted: false, gain: 1, drives: false },
): MediaTimeline {
	const lane = createMediaLane("Layer 1", "vid");
	lane.audio = audio;
	lane.clips = clips.map(([s, e, into]) => createMediaClip(s, e, into ?? 0));
	return { enabled: true, lanes: [lane] };
}

describe("planMix", () => {
	it("plays a video clip's sound from its in-point", () => {
		const plan = planMix({
			timeline: videoTimeline([[2, 5, 1]]),
			edits: {},
			videos: { vid: 10 },
		});
		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({ start: 2, end: 5, offset: 1, rate: 1 });
	});

	it("wraps with the picture when the clip outlasts the video", () => {
		const plan = planMix({
			timeline: videoTimeline([[0, 5, 2]]),
			edits: {},
			videos: { vid: 3 },
		});
		expect(plan.map((s) => [s.start, s.end, s.offset])).toEqual([
			[0, 1, 2],
			[1, 4, 0],
			[4, 5, 0],
		]);
	});

	it("follows the source's speed and span", () => {
		const edit = {
			...createSourceEdit(),
			speed: 2,
			span: { start: 1, end: 3 },
		};
		const plan = planMix({
			timeline: videoTimeline([[0, 2]]),
			edits: { vid: edit },
			videos: { vid: 10 },
		});
		// Two seconds of source per loop at 2x is one second of timeline.
		expect(plan.map((s) => [s.start, s.end, s.offset, s.rate])).toEqual([
			[0, 1, 1, 2],
			[1, 2, 1, 2],
		]);
	});

	it("leaves muted lanes, detached clips and images silent", () => {
		expect(
			planMix({
				timeline: videoTimeline([[0, 2]], {
					muted: true,
					gain: 1,
					drives: false,
				}),
				edits: {},
				videos: { vid: 10 },
			}),
		).toHaveLength(0);
		const detached = videoTimeline([[0, 2]]);
		detached.lanes[0].clips[0].audioDetached = true;
		expect(
			planMix({ timeline: detached, edits: {}, videos: { vid: 10 } }),
		).toHaveLength(0);
		expect(
			planMix({ timeline: videoTimeline([[0, 2]]), edits: {}, videos: {} }),
		).toHaveLength(0);
	});

	it("plays library tracks once, with lane, clip and source gain multiplied", () => {
		const lane = createAudioLane("Music", true);
		lane.gain = 0.5;
		const clip = createAudioClip(1, 4, trackSourceId("song"), 10);
		clip.gain = 0.5;
		lane.clips = [clip];
		const plan = planMix({
			timeline: { enabled: true, lanes: [], audioLanes: [lane] },
			edits: {},
			videos: {},
			sourceGains: { [trackSourceId("song")]: 2 },
		});
		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({
			start: 1,
			end: 4,
			offset: 10,
			gain: 0.5,
			drives: true,
		});
	});
});

describe("trimSegment", () => {
	it("moves the offset with the cut, at the segment's rate", () => {
		const [seg] = planMix({
			timeline: videoTimeline([[0, 4]]),
			edits: { vid: { ...createSourceEdit(), speed: 2 } },
			videos: { vid: 100 },
		});
		expect(trimSegment(seg, 1, 3)).toMatchObject({
			start: 1,
			end: 3,
			offset: 2,
		});
		expect(trimSegment(seg, 5, 6)).toBeNull();
	});
});

describe("segmentEnvelope", () => {
	it("breaks at the fade edges", () => {
		const lane = createAudioLane("Voice");
		const clip = createAudioClip(0, 10, trackSourceId("v"));
		clip.fadeInSec = 2;
		clip.fadeOutSec = 4;
		lane.clips = [clip];
		const [seg] = planMix({
			timeline: { enabled: true, lanes: [], audioLanes: [lane] },
			edits: {},
			videos: {},
		});
		expect(segmentEnvelope(seg)).toEqual([
			{ t: 0, gain: 0 },
			{ t: 2, gain: 1 },
			{ t: 6, gain: 1 },
			{ t: 10, gain: 0 },
		]);
	});
});
