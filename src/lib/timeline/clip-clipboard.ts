/**
 * The clip clipboard every lane kind shares: a copy snapshots the selection
 * as a block anchored at its earliest clip, a paste stamps that block down
 * as new clips, and a paste *onto* a selection pours what the copies carried
 * into clips that keep their own spans. What a clip carries — its words, its
 * media, its chain — is the kind's business, through the callbacks.
 */

import {
	placeClipBlock,
	retargetClipBlock,
	sortClips,
	type ClipBlockEntry,
	type ClipLane,
	type TimelineClip,
} from "./clips";

type Lane<C extends TimelineClip> = ClipLane<C> & { id: string };

/** Snapshot the given clips, anchored at the earliest one's start. */
export function copyClipBlock<
	C extends TimelineClip,
	L extends Lane<C>,
	E extends ClipBlockEntry,
>(
	lanes: L[],
	clipIds: string[],
	capture: (clip: C, lane: L) => Omit<E, keyof ClipBlockEntry>,
): E[] {
	const ids = new Set(clipIds);
	const found: E[] = [];
	let anchor = Infinity;
	for (const lane of lanes) {
		for (const clip of lane.clips) {
			if (!ids.has(clip.id)) continue;
			anchor = Math.min(anchor, clip.start);
			found.push({
				...capture(clip, lane),
				laneId: lane.id,
				offset: clip.start,
				length: clip.end - clip.start,
			} as E);
		}
	}
	return found
		.map((e) => ({ ...e, offset: e.offset - anchor }))
		.sort((a, b) => a.offset - b.offset);
}

export interface ClipBlockPaste<L> {
	lanes: L[];
	/** The clips that landed, for the caller to select. Empty on a no-op. */
	clipIds: string[];
}

/**
 * Stamp the block down with its earliest clip at `at`, on `targetLaneId` when
 * that is one of these lanes (the block's other lanes follow below it) and
 * otherwise back where it was copied from. See placeClipBlock for where the
 * copies land when the space is short. `build` makes each clip; `retargeted`
 * tells it the block moved lanes, for anything a copy inherits from its lane.
 */
export function pasteClipBlock<
	C extends TimelineClip,
	L extends Lane<C>,
	E extends ClipBlockEntry,
>(
	lanes: L[],
	entries: E[],
	at: number,
	duration: number,
	targetLaneId: string | null | undefined,
	build: (
		entry: E,
		start: number,
		end: number,
		lane: L,
		retargeted: boolean,
	) => C,
): ClipBlockPaste<L> {
	const unchanged: ClipBlockPaste<L> = { lanes, clipIds: [] };
	if (entries.length === 0 || duration <= 0) return unchanged;
	const byId = new Map<string, L>(lanes.map((l) => [l.id, l]));
	const moved = retargetClipBlock(
		entries,
		lanes.map((l) => l.id),
		targetLaneId,
	);
	// A lane deleted since the copy takes its clips with it.
	const placed = placeClipBlock(moved, byId, at, duration);
	if (placed.length === 0) return unchanged;

	const added = new Map<string, C[]>();
	const clipIds: string[] = [];
	for (const { entry, start, end } of placed) {
		const clip = build(
			entry,
			start,
			end,
			byId.get(entry.laneId)!,
			moved !== entries,
		);
		clipIds.push(clip.id);
		const list = added.get(entry.laneId);
		if (list) list.push(clip);
		else added.set(entry.laneId, [clip]);
	}
	return {
		lanes: lanes.map((lane) => {
			const list = added.get(lane.id);
			return list
				? { ...lane, clips: sortClips([...lane.clips, ...list]) }
				: lane;
		}),
		clipIds,
	};
}

/**
 * Pour the copies into the selected clips, in time order; a shorter copy
 * repeats over them. Each target keeps its span and lane — `apply` decides
 * what else it keeps. The same lanes back when none of the targets is here.
 */
export function pasteOntoClips<C extends TimelineClip, L extends Lane<C>, E>(
	lanes: L[],
	clipIds: string[],
	entries: E[],
	apply: (clip: C, entry: E, lane: L) => C,
): L[] {
	if (entries.length === 0 || clipIds.length === 0) return lanes;
	const targets = new Set(clipIds);
	const order = lanes
		.flatMap((l) => l.clips)
		.filter((c) => targets.has(c.id))
		.sort((a, b) => a.start - b.start)
		.map((c) => c.id);
	if (order.length === 0) return lanes;
	return lanes.map((lane) => {
		if (!lane.clips.some((c) => targets.has(c.id))) return lane;
		return {
			...lane,
			clips: lane.clips.map((c) => {
				const i = order.indexOf(c.id);
				return i === -1 ? c : apply(c, entries[i % entries.length], lane);
			}),
		};
	});
}
