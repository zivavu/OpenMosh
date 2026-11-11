import {
	clearMediaClips,
	fillMediaClipsFromPreset,
	findMediaClip,
	findMediaClipLane,
	replaceMediaClip,
	restoreMediaClipMosh,
	rollMediaClips,
	setMediaClipsMode,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
} from "../media";
import { updateMediaClips } from "../media/resolve";
import {
	clearTextClips,
	fillTextClipsFromPreset,
	findTextClip,
	findTextClipLane,
	replaceTextClip,
	restoreTextClipMosh,
	rollTextClips,
	setTextClipsMode,
	type TextClip,
	type TextLane,
	type TextTimeline,
} from "../text";
import { updateTextClips } from "../text/resolve";
import type { ChainTimelineOps } from "./chain-timeline-state.svelte";
import {
	fanOutMediaClipFields,
	fanOutMediaLaneEdit,
	fanOutTextClipFields,
	fanOutTextLaneEdit,
} from "./field-fanout";

export const textTimelineOps: ChainTimelineOps<
	TextTimeline,
	TextLane,
	TextClip
> = {
	findClip: findTextClip,
	findLane: findTextClipLane,
	replaceClip: replaceTextClip,
	updateClips: updateTextClips,
	fanOutClipFields: fanOutTextClipFields,
	fanOutLaneEdit: fanOutTextLaneEdit,
	roll: rollTextClips,
	restoreMosh: restoreTextClipMosh,
	clear: clearTextClips,
	fillFromPreset: fillTextClipsFromPreset,
	setMode: setTextClipsMode,
	selectionNote: (count) =>
		`Edits here change all ${count} selected clips. Each keeps its own text.`,
};

export function mediaTimelineOps(
	isModel: (sourceId: string) => boolean,
): ChainTimelineOps<MediaTimeline, MediaLane, MediaClip> {
	return {
		findClip: findMediaClip,
		findLane: findMediaClipLane,
		replaceClip: replaceMediaClip,
		updateClips: updateMediaClips,
		fanOutClipFields: fanOutMediaClipFields,
		fanOutLaneEdit: fanOutMediaLaneEdit,
		roll: (timeline, ids, options) =>
			rollMediaClips(timeline, ids, options, isModel),
		restoreMosh: restoreMediaClipMosh,
		clear: clearMediaClips,
		fillFromPreset: fillMediaClipsFromPreset,
		setMode: setMediaClipsMode,
		selectionNote: (count) =>
			`Edits here change all ${count} selected clips. Media, start and speed stay per clip.`,
	};
}
