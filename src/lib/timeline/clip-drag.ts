/** One pointermove of a clip drag, shared by every lane of free-floating clips.
 * Works out where the pointer wants the clips, lets the stack pull that onto a snap
 * target, then applies the lane's own limits, which always win over the snap. */

import {
	moveClipsIn,
	resizeBoundary,
	resizeClipsIn,
	sortClips,
	type ClipLane,
	type SourceAnchor,
	type TimelineClip,
} from "./clips";
import { sourceEndOwner } from "./snap";

export interface ClipDrag {
	laneId: string;
	clipId: string;
	/** The clip on the far side of a shared-boundary drag. */
	otherId?: string;
	mode: "move" | "start" | "end" | "boundary";
	/** Seconds between the pointer and the clip's start, for move drags. */
	grabOffset: number;
}

/** The shift that lands one of `edges` on a snap target; 0 for none. */
export type SnapShift = (edges: number[], exclude: Set<string>) => number;

export interface ClipDragStep<L> {
	lanes: L[];
	/** Where the dragged edges ended up, for the stack to check its guide against. */
	edges: number[];
}

/** Apply a drag with the pointer at time `t`. `groupIds` is the selection when the
 * held clip is part of one: the whole group moves or trims, on whatever lanes it sits,
 * and snaps by its closest edge. */
export function dragClipsStep<C extends TimelineClip, L extends ClipLane<C>>(
	lanes: L[],
	drag: ClipDrag,
	t: number,
	groupIds: string[],
	duration: number,
	snap: SnapShift,
	anchor?: SourceAnchor<C>,
): ClipDragStep<L> {
	const { clipId, otherId, mode, grabOffset } = drag;
	const ids = groupIds.includes(clipId) ? groupIds : [clipId];
	const all = lanes.flatMap((l) => l.clips);
	const held = all.find((c) => c.id === clipId);
	if (!held) return { lanes, edges: [] };
	const moving = all.filter((c) => ids.includes(c.id));
	const movedEdges = (next: L[], keys: ("start" | "end")[]) =>
		next
			.flatMap((l) => l.clips)
			.filter((c) => ids.includes(c.id))
			.flatMap((c) => keys.map((k) => c[k]));
	if (mode === "move") {
		// A delta off the held clip's live position: each move re-enters against shifted lanes.
		const wanted = t - grabOffset - held.start;
		// Their media ends travel with them.
		const shift = snap(
			moving.flatMap((c) => [c.start + wanted, c.end + wanted]),
			new Set([...ids, ...ids.map(sourceEndOwner)]),
		);
		const next = moveClipsIn(lanes, ids, wanted + shift, duration);
		return { lanes: next, edges: movedEdges(next, ["start", "end"]) };
	}
	if (mode === "boundary") {
		// The left clip's media end holds still; the right one's slides with its start.
		const at =
			t + snap([t], new Set([clipId, otherId!, sourceEndOwner(otherId!)]));
		const next = lanes.map((l) =>
			l.clips.some((c) => c.id === clipId)
				? resizeBoundary(l, clipId, otherId!, at)
				: l,
		);
		const left = next.flatMap((l) => l.clips).find((c) => c.id === clipId);
		return { lanes: next, edges: left ? [left.end] : [] };
	}
	const exclude = new Set(ids);
	if (mode === "start") for (const id of ids) exclude.add(sourceEndOwner(id));
	const wanted = t - held[mode];
	const shift = snap(
		moving.map((c) => c[mode] + wanted),
		exclude,
	);
	const next = resizeClipsIn(
		lanes,
		ids,
		mode,
		wanted + shift,
		duration,
		anchor,
	);
	return { lanes: next, edges: movedEdges(next, [mode]) };
}

/** Every edge on a lane, owned by its clip — the lane's snap targets. */
export function laneSnapPoints<C extends TimelineClip>(
	lane: ClipLane<C> | undefined,
): { time: number; ownerId: string }[] {
	if (!lane) return [];
	return sortClips(lane.clips).flatMap((c) => [
		{ time: c.start, ownerId: c.id },
		{ time: c.end, ownerId: c.id },
	]);
}
