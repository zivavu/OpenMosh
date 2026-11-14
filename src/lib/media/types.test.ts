import { describe, expect, it } from "bun:test";
import { resizeClipsIn } from "../timeline/clips";
import { DEFAULT_SOURCE_EDIT, type SourceEdit } from "./source-edit";
import {
	createMediaClip,
	createMediaLane,
	duplicateMediaLane,
	mediaSourceAnchor,
	type MediaClip,
	type TimedClipMedia,
} from "./types";

describe("duplicateMediaLane", () => {
	it("copies clips and chains under fresh ids", () => {
		const lane = {
			...createMediaLane("Media 1", "src-a", 2),
			clips: [createMediaClip(0, 4, 0), createMediaClip(6, 9, 1)],
		};
		const copy = duplicateMediaLane(lane, 5);

		expect(copy.id).not.toBe(lane.id);
		expect(copy.name).toBe("Media 1 copy");
		expect(copy.z).toBe(5);
		expect(copy.sourceId).toBe("src-a");
		expect(copy.clips.map((c) => [c.start, c.end])).toEqual([
			[0, 4],
			[6, 9],
		]);
		copy.clips.forEach((clip, i) => {
			const from = lane.clips[i];
			expect(clip.id).not.toBe(from.id);
			expect(clip.effects.map((e) => e.defId)).toEqual(
				from.effects.map((e) => e.defId),
			);
			clip.effects.forEach((e, j) =>
				expect(e.instanceId).not.toBe(from.effects[j].instanceId),
			);
		});
	});
});

describe("mediaSourceAnchor", () => {
	const trimStart = (
		clip: MediaClip,
		delta: number,
		media: TimedClipMedia | null,
	) => {
		const lane = { ...createMediaLane("Media 1", "src"), clips: [clip] };
		const [out] = resizeClipsIn(
			[lane],
			[clip.id],
			"start",
			delta,
			60,
			mediaSourceAnchor(() => media),
		);
		const c = out.clips[0];
		return [c.start, c.end, c.sourceStart];
	};
	const video: TimedClipMedia = { length: 10 };

	it("uncovers a video's cut-off start in place, as far as the media goes", () => {
		expect(trimStart(createMediaClip(2, 5, 1), -0.5, video)).toEqual([
			1.5, 5, 0.5,
		]);
		expect(trimStart(createMediaClip(2, 5, 1), -3, video)).toEqual([1, 5, 0]);
	});

	it("hides the media under a start dragged right", () => {
		expect(trimStart(createMediaClip(2, 5, 1), 1, video)).toEqual([3, 5, 2]);
	});

	it("walks the in-point at the source's speed and stops at its span", () => {
		const edit: SourceEdit = {
			...DEFAULT_SOURCE_EDIT,
			speed: 2,
			span: { start: 0.5, end: 8 },
		};
		expect(
			trimStart(createMediaClip(2, 5, 1.5), -3, { edit, length: 10 }),
		).toEqual([1.5, 5, 0.5]);
	});

	it("goes forward through the media on a bounce's way back", () => {
		const clip = { ...createMediaClip(2, 5, 8), bounceBack: true };
		expect(trimStart(clip, -5, video)).toEqual([0, 5, 10]);
	});

	it("leaves an image's start free", () => {
		expect(trimStart(createMediaClip(2, 5, 0), -2, null)).toEqual([0, 5, 0]);
	});
});
