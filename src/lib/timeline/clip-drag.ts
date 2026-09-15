/**
 * One pointermove of a clip drag, shared by every lane of free-floating clips
 * (text, fx, media). Works out where the pointer wants the clips, lets the
 * stack pull that onto a snap target, then applies the lane's own limits —
 * neighbours and the minimum length — which always win over the snap.
 */

import {
	moveClips,
	resizeBoundary,
	resizeClip,
	sortClips,
	type ClipLane,
	type TimelineClip,
} from "./clips";

export interface ClipDrag {
	laneId: string;
	clipId: string;
	/** The clip on the far side of a shared-boundary drag. */
	otherId?: string;
	mode: "move" | "start" | "end" | "boundary";
	/** Seconds between the pointer and the clip's start, for move drags. */
	grabOffset: number;
}

/** The shift that lands one of `edges` on a snap target; 0 for none. Owners
 * in `exclude` are the clips being dragged, whose edges must not pull. */
export type SnapShift = (edges: number[], exclude: Set<string>) => number;

export interface ClipDragStep<L> {
	lane: L;
	/** Where the dragged edges ended up, for the stack to check its guide
	 * against: a neighbour can stop them short of the target. */
	edges: number[];
}

/**
 * Apply a drag to its lane with the pointer at time `t`. `groupIds` is the
 * selection when the held clip is part of one; every member on this lane moves
 * with it, and the whole group snaps by whichever member's edge is closest.
 */
export function dragClipsStep<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	drag: ClipDrag,
	t: number,
	groupIds: string[],
	duration: number,
	snap: SnapShift,
): ClipDragStep<L> {
	const { clipId, otherId, mode, grabOffset } = drag;
	if (mode === "move") {
		const ids = groupIds.includes(clipId) ? groupIds : [clipId];
		const held = lane.clips.find((c) => c.id === clipId);
		if (!held) return { lane, edges: [] };
		// A delta off the held clip's live position: each move re-enters here
		// against an already-shifted lane.
		const wanted = t - grabOffset - held.start;
		const moving = lane.clips.filter((c) => ids.includes(c.id));
		const shift = snap(
			moving.flatMap((c) => [c.start + wanted, c.end + wanted]),
			new Set(ids),
		);
		const next = moveClips(lane, ids, wanted + shift, duration);
		return {
			lane: next,
			edges: next.clips
				.filter((c) => ids.includes(c.id))
				.flatMap((c) => [c.start, c.end]),
		};
	}
	if (mode === "boundary") {
		const at = t + snap([t], new Set([clipId, otherId!]));
		const next = resizeBoundary(lane, clipId, otherId!, at);
		const left = next.clips.find((c) => c.id === clipId);
		return { lane: next, edges: left ? [left.end] : [] };
	}
	const at = t + snap([t], new Set([clipId]));
	const next = resizeClip(lane, clipId, mode, at, duration);
	const clip = next.clips.find((c) => c.id === clipId);
	return { lane: next, edges: clip ? [clip[mode]] : [] };
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
