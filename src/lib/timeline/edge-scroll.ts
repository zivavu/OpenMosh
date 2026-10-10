/** Scrolling the timeline while a drag holds the pointer at or past a lane edge. */

/** Inside the lane, how close to an edge the pointer starts the scroll. */
export const EDGE_ZONE_PX = 24;
/** Screen pixels per second; past this the view would blur by. */
const MAX_SPEED_PX = 6000;

/** How far into the scroll zone the pointer is, in px: negative on the left, 0 clear of both. */
export function edgeOvershoot(
	clientX: number,
	left: number,
	right: number,
	zone = EDGE_ZONE_PX,
): number {
	if (right - left <= zone * 2) return 0;
	if (clientX < left + zone) return clientX - (left + zone);
	if (clientX > right - zone) return clientX - (right - zone);
	return 0;
}

/** Screen pixels per second for an overshoot, growing faster than the distance. */
export function edgeScrollSpeed(overshootPx: number): number {
	const d = Math.abs(overshootPx);
	return Math.min(MAX_SPEED_PX, 4 * d + 0.08 * d * d);
}
