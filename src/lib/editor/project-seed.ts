/** A new editor project's first shape: how long it runs, and the lanes its song and
 * opened file start on. */

import { createMediaClip, createMediaLane, type MediaTimeline } from "../media";
import {
	audioLanesEnd,
	createAudioClip,
	createAudioLane,
	nextAudioLaneName,
} from "../mix/types";
import type { TimelineClip } from "../timeline/clips";

/** Length a new project takes when nothing else gives it one. */
export const DEFAULT_PROJECT_LENGTH = 30;

type ClipLanes = { clips: TimelineClip[] }[];

/** The latest clip end on any lane, sound included. */
export function contentEnd(media: MediaTimeline, ...others: ClipLanes[]) {
	let end = audioLanesEnd(media.audioLanes);
	for (const lane of [...media.lanes, ...others.flat()]) {
		for (const clip of lane.clips) end = Math.max(end, clip.end);
	}
	return end;
}

/** Where the first clip on any lane starts; 0 for an empty project. */
export function contentStart(media: MediaTimeline, ...others: ClipLanes[]) {
	let start = Infinity;
	for (const lane of [
		...media.lanes,
		...(media.audioLanes ?? []),
		...others.flat(),
	]) {
		for (const clip of lane.clips) start = Math.min(start, clip.start);
	}
	return Number.isFinite(start) ? start : 0;
}

/** The song's length, else the clips', else the opened media's, else the default. */
export function seedLength(opts: {
	songLength: number;
	contentEnd: number;
	mediaLength: number;
}): number {
	if (opts.songLength > 0) return opts.songLength;
	if (opts.contentEnd > 0) return opts.contentEnd;
	if (opts.mediaLength > 0) return opts.mediaLength;
	return DEFAULT_PROJECT_LENGTH;
}

/** The song on a driving lane of its own, unless a lane plays it already, and the
 * opened media filling the project on its first lane when there's none. */
export function seedTimeline(
	timeline: MediaTimeline,
	opts: {
		length: number;
		song: { sourceId: string; length: number } | null;
		mediaSourceId: string | null;
	},
): MediaTimeline {
	let next = timeline;
	const lanes = next.audioLanes ?? [];
	const { song, length } = opts;
	if (
		song &&
		song.length > 0 &&
		!lanes.some((l) => l.clips.some((c) => c.sourceId === song.sourceId))
	) {
		const lane = createAudioLane(nextAudioLaneName(lanes), true);
		lane.clips = [
			createAudioClip(0, Math.min(song.length, length), song.sourceId),
		];
		next = { ...next, audioLanes: [lane, ...lanes] };
	}
	if (opts.mediaSourceId && next.lanes.length === 0) {
		const lane = createMediaLane("Media 1", opts.mediaSourceId, 0);
		lane.clips = [createMediaClip(0, length)];
		// Under a song the opened video is a backdrop; its own sound would fight it.
		if (song && lane.audio) lane.audio = { ...lane.audio, muted: true };
		next = { ...next, enabled: true, lanes: [lane] };
	}
	return next;
}
