/**
 * Copy/paste for media layer clips.
 *
 * A clip carries its span, its in-point and whichever source it was retargeted
 * to. The placement and the effect chain live on the lane and are shared by
 * every clip on it, so a whole-clip paste lands back in the lane it came
 * from, where both come along by themselves. Pasting onto another lane would
 * mean overwriting that lane's chain for the sake of one clip, which is a lane
 * edit wearing a clip's clothes.
 *
 * Pasting *onto* a clip is the other half: what the copied clip showed — its
 * source and in-point — dropped into a clip that keeps its own span, fade and
 * lane. That one can cross lanes, since it changes nothing about the lane.
 */

import {
	firstFreeDelta,
	sortClips,
	type ClipBlockEntry,
} from "../timeline/clips";
import { createMediaClip, type MediaClip, type MediaLane } from "./types";
import type { MediaTimeline } from "./types";

/** One copied clip, placed relative to the earliest one in the copy. */
export interface MediaClipboardEntry extends ClipBlockEntry {
	sourceStart: number;
	/** The clip's own source, when it had one; absent means the lane's. */
	sourceId?: string;
	/** What the clip showed, resolved through its lane at copy time — so a
	 * paste onto a clip elsewhere shows the same picture even if the lane it
	 * came from has since been repointed or deleted. Null for a clip on a lane
	 * with no source yet. */
	resolvedSourceId: string | null;
	fadeSec?: number;
}

/** Snapshot the given clips, anchored at the earliest one's start. */
export function copyMediaClips(
	timeline: MediaTimeline,
	clipIds: string[],
): MediaClipboardEntry[] {
	const ids = new Set(clipIds);
	const found: MediaClipboardEntry[] = [];
	let anchor = Infinity;
	for (const lane of timeline.lanes) {
		for (const clip of lane.clips) {
			if (!ids.has(clip.id)) continue;
			anchor = Math.min(anchor, clip.start);
			found.push({
				laneId: lane.id,
				offset: clip.start,
				length: clip.end - clip.start,
				sourceStart: clip.sourceStart,
				sourceId: clip.sourceId,
				resolvedSourceId: clip.sourceId ?? lane.sourceId,
				fadeSec: clip.fadeSec,
			});
		}
	}
	if (found.length === 0) return [];
	return found
		.map((e) => ({ ...e, offset: e.offset - anchor }))
		.sort((a, b) => a.offset - b.offset);
}

export interface MediaPasteResult {
	timeline: MediaTimeline;
	/** The clips that landed, for the caller to select. Empty on a no-op. */
	clipIds: string[];
}

/**
 * Stamp the clipboard down with its earliest clip at `at`, slid right to the
 * first place the whole block fits (see firstFreeDelta). When nothing
 * downstream has room, nothing is pasted.
 */
export function pasteMediaClips(
	timeline: MediaTimeline,
	entries: MediaClipboardEntry[],
	at: number,
	duration: number,
): MediaPasteResult {
	const unchanged: MediaPasteResult = { timeline, clipIds: [] };
	if (entries.length === 0 || duration <= 0) return unchanged;

	const lanes = new Map<string, MediaLane>(
		timeline.lanes.map((l) => [l.id, l]),
	);
	// A lane deleted since the copy takes its clips with it.
	const live = entries.filter((e) => lanes.has(e.laneId));
	const delta = firstFreeDelta(live, lanes, Math.max(0, at), duration);
	if (delta === null) return unchanged;

	const added = new Map<string, MediaClip[]>();
	const clipIds: string[] = [];
	for (const e of live) {
		const start = Math.max(0, at) + e.offset + delta;
		const clip = createMediaClip(
			start,
			start + e.length,
			e.sourceStart,
			e.sourceId,
		);
		if (e.fadeSec !== undefined) clip.fadeSec = e.fadeSec;
		clipIds.push(clip.id);
		const list = added.get(e.laneId);
		if (list) list.push(clip);
		else added.set(e.laneId, [clip]);
	}

	return {
		timeline: {
			...timeline,
			lanes: timeline.lanes.map((lane) => {
				const list = added.get(lane.id);
				return list
					? { ...lane, clips: sortClips([...lane.clips, ...list]) }
					: lane;
			}),
		},
		clipIds,
	};
}

/**
 * Put what the copied clips showed into the selected clips, in time order; a
 * shorter copy repeats over them. Each target keeps its span, fade and lane
 * and takes the source and in-point. The source is pinned on the clip unless
 * it is already what its lane shows, so the lane's own picker keeps meaning
 * "this lane's default" for the clips that never chose.
 */
export function pasteMediaContentOnto(
	timeline: MediaTimeline,
	clipIds: string[],
	entries: MediaClipboardEntry[],
): MediaTimeline {
	if (entries.length === 0 || clipIds.length === 0) return timeline;
	const targets = new Set(clipIds);
	const order = timeline.lanes
		.flatMap((l) => l.clips)
		.filter((c) => targets.has(c.id))
		.sort((a, b) => a.start - b.start)
		.map((c) => c.id);
	if (order.length === 0) return timeline;
	return {
		...timeline,
		lanes: timeline.lanes.map((lane) => {
			if (!lane.clips.some((c) => targets.has(c.id))) return lane;
			return {
				...lane,
				clips: lane.clips.map((c) => {
					const i = order.indexOf(c.id);
					if (i === -1) return c;
					const e = entries[i % entries.length];
					const sourceId = e.resolvedSourceId ?? undefined;
					return {
						...c,
						sourceStart: e.sourceStart,
						sourceId: sourceId === lane.sourceId ? undefined : sourceId,
					};
				}),
			};
		}),
	};
}
