/** On-screen sizing for the clips on a lane: how wide a clip is in pixels and how
 * much of it a grab handle may take. Shared by every lane kind. */

import { sortClips, type ClipLane, type TimelineClip } from "./clips";

/** Comfortable grab width for a shared boundary, in px. */
const BOUNDARY_GRAB = 12;
/** Comfortable grab width for a clip's own start/end handles, in px. */
const EDGE_GRAB = 10;

/** What the sizing is measured against: the view's span and the lane's width. */
export interface LaneScale {
	viewDuration: number;
	laneWidthPx: number;
}

export function clipPx(
	span: { start: number; end: number },
	scale: LaneScale,
): number {
	if (scale.laneWidthPx <= 0) return 0;
	return ((span.end - span.start) / scale.viewDuration) * scale.laneWidthPx;
}

/** Sized against the clip rather than fixed. At a flat 10px each, two handles
 * overrun any clip under 20px wide and the right one is clipped away entirely. A
 * third each keeps both edges grabbable and leaves the middle third to drag by. */
export function edgeWidth(clip: TimelineClip, scale: LaneScale): number {
	const px = clipPx(clip, scale);
	if (px <= 0) return EDGE_GRAB;
	return Math.max(1, Math.min(EDGE_GRAB, px / 3));
}

/** A boundary is drawn over the clips either side of it, so a fixed grab area would
 * blanket short clips entirely. Never take more than a third of the narrower neighbour. */
export function boundaryWidth(
	left: TimelineClip,
	right: TimelineClip,
	scale: LaneScale,
): number {
	if (scale.laneWidthPx <= 0) return BOUNDARY_GRAB;
	const narrower = Math.min(left.end - left.start, right.end - right.start);
	const narrowerPx = (narrower / scale.viewDuration) * scale.laneWidthPx;
	return Math.max(2, Math.min(BOUNDARY_GRAB, narrowerPx / 3));
}

export interface AdjacentPair<C extends TimelineClip> {
	left: C;
	right: C;
	at: number;
}

/** Consecutive clip pairs sharing an exact edge — the draggable boundaries. */
export function adjacentPairs<C extends TimelineClip>(
	lane: ClipLane<C>,
): AdjacentPair<C>[] {
	const clips = sortClips(lane.clips);
	const pairs: AdjacentPair<C>[] = [];
	for (let i = 0; i + 1 < clips.length; i++) {
		if (clips[i].end === clips[i + 1].start) {
			pairs.push({ left: clips[i], right: clips[i + 1], at: clips[i].end });
		}
	}
	return pairs;
}
