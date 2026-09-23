/** Joins between touching clips as a selection: moving several at once, and
 * copying their cut pattern to lay down somewhere else. */

import {
	MIN_CLIP_LENGTH,
	sortClips,
	type ClipLane,
	type TimelineClip,
} from "./clips";
import { adjacentPairs } from "./lane-geometry";

type Lane<C extends TimelineClip> = ClipLane<C> & { id: string };

export interface JoinRef {
	laneId: string;
	leftId: string;
	/** The clip that starts on the join: how a join is named. */
	rightId: string;
	at: number;
}

/** The joins named by `rightIds`, where they still exist. */
export function joinRefs<C extends TimelineClip>(
	lanes: Lane<C>[],
	rightIds: string[],
): JoinRef[] {
	const wanted = new Set(rightIds);
	return lanes.flatMap((lane) =>
		adjacentPairs(lane)
			.filter((p) => wanted.has(p.right.id))
			.map((p) => ({
				laneId: lane.id,
				leftId: p.left.id,
				rightId: p.right.id,
				at: p.at,
			})),
	);
}

/** How far the group can move before a clip gets too short. A clip whose both
 * edges move keeps its length, so only edges staying put limit it. */
export function joinDeltaLimits<C extends TimelineClip>(
	lanes: Lane<C>[],
	joins: JoinRef[],
): { min: number; max: number } {
	const startsMoving = new Set(joins.map((j) => j.rightId));
	const endsMoving = new Set(joins.map((j) => j.leftId));
	let min = -Infinity;
	let max = Infinity;
	for (const j of joins) {
		const lane = lanes.find((l) => l.id === j.laneId);
		const left = lane?.clips.find((c) => c.id === j.leftId);
		const right = lane?.clips.find((c) => c.id === j.rightId);
		if (!left || !right) continue;
		if (!startsMoving.has(left.id)) {
			min = Math.max(min, left.start + MIN_CLIP_LENGTH - j.at);
		}
		if (!endsMoving.has(right.id)) {
			max = Math.min(max, right.end - MIN_CLIP_LENGTH - j.at);
		}
	}
	return min > max ? { min: 0, max: 0 } : { min, max };
}

/** Every join put at its drag-start time plus `delta`. */
export function moveJoins<C extends TimelineClip, L extends Lane<C>>(
	lanes: L[],
	joins: JoinRef[],
	delta: number,
): L[] {
	const ends = new Map(joins.map((j) => [j.leftId, j.at + delta]));
	const starts = new Map(joins.map((j) => [j.rightId, j.at + delta]));
	const touched = new Set(joins.map((j) => j.laneId));
	return lanes.map((lane) =>
		touched.has(lane.id)
			? {
					...lane,
					clips: sortClips(
						lane.clips.map((c) =>
							ends.has(c.id) || starts.has(c.id)
								? {
										...c,
										start: starts.get(c.id) ?? c.start,
										end: ends.get(c.id) ?? c.end,
									}
								: c,
						),
					),
				}
			: lane,
	);
}

/** A copied join: where it sits against the first, and on which lane below the first's. */
export interface CopiedJoin<D> {
	offset: number;
	laneOffset: number;
	/** What the join carried, e.g. its transition. */
	data: D;
}

/** The cut pattern of `joins`, with lanes counted in `laneOrder` (top to bottom). */
export function copyJoins<C extends TimelineClip, D>(
	lanes: Lane<C>[],
	joins: JoinRef[],
	laneOrder: string[],
	read: (right: C) => D,
): CopiedJoin<D>[] {
	if (joins.length === 0) return [];
	const first = Math.min(...joins.map((j) => j.at));
	const topLane = Math.min(...joins.map((j) => laneOrder.indexOf(j.laneId)));
	return joins
		.map((j) => {
			const right = lanes
				.find((l) => l.id === j.laneId)
				?.clips.find((c) => c.id === j.rightId);
			return {
				offset: j.at - first,
				laneOffset: laneOrder.indexOf(j.laneId) - topLane,
				data: read(right!),
			};
		})
		.sort((a, b) => a.offset - b.offset);
}

/** The lane and time each copied join lands on, for a paste anchored at `time` on
 * `laneId`. Joins that fall off the lanes or the track are left out. */
export function joinPastePoints<D>(
	copied: CopiedJoin<D>[],
	laneOrder: string[],
	laneId: string,
	time: number,
	duration: number,
): { laneId: string; at: number; data: D }[] {
	const base = laneOrder.indexOf(laneId);
	if (base === -1) return [];
	return copied.flatMap((j) => {
		const target = laneOrder[base + j.laneOffset];
		const at = time + j.offset;
		return target && at > 0 && at < duration
			? [{ laneId: target, at, data: j.data }]
			: [];
	});
}

/** Cut the lanes at each point and hand the clip now starting there its data. A point
 * already on a join just takes the data; one in empty space does nothing. */
export function pasteJoins<C extends TimelineClip, L extends Lane<C>, D>(
	lanes: L[],
	points: { laneId: string; at: number; data: D }[],
	split: (lane: L, at: number) => L,
	write: (right: C, data: D) => C,
): { lanes: L[]; rightIds: string[] } {
	const rightIds: string[] = [];
	let next = lanes;
	for (const p of points) {
		next = next.map((lane) => {
			if (lane.id !== p.laneId) return lane;
			const cut = split(lane, p.at);
			const pair = adjacentPairs(cut).find((q) => Math.abs(q.at - p.at) < 1e-6);
			if (!pair) return cut;
			rightIds.push(pair.right.id);
			return {
				...cut,
				clips: cut.clips.map((c) =>
					c.id === pair.right.id ? write(c, p.data) : c,
				),
			};
		});
	}
	return { lanes: next, rightIds };
}
