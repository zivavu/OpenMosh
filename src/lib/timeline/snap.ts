/**
 * Magnetic snapping for drags on the timeline stack. Pure: the stack collects
 * the targets from its lanes and works out the threshold from the zoom; this
 * only answers "which edge lands where".
 */

/** Something a dragged edge can land on. */
export interface SnapPoint {
	time: number;
	/** The clip or segment this edge belongs to, so a drag can leave its own
	 * edges out. Null for points that belong to nobody: the ends of the
	 * timeline, the start marker. */
	ownerId: string | null;
}

export interface SnapHit {
	/** How far to shift the dragged edges so one of them lands on `at`. */
	shift: number;
	at: number;
}

/**
 * The nearest target within `threshold` of any of `edges`, as the shift that
 * lands that edge on it. Edges move together, so the one closest to a target
 * decides for all of them. Targets owned by anything in `exclude` are skipped.
 *
 * `beatSec` > 0 adds the beat grid as targets, at lower priority: an edge and
 * a beat at the same distance snap to the edge, since a thing on screen is a
 * better explanation for the pull than a grid that isn't drawn.
 */
export function findSnap(
	edges: number[],
	targets: SnapPoint[],
	threshold: number,
	exclude: ReadonlySet<string>,
	beatSec = 0,
): SnapHit | null {
	let best: SnapHit | null = null;
	let bestDist = threshold;
	for (const edge of edges) {
		for (const target of targets) {
			if (target.ownerId !== null && exclude.has(target.ownerId)) continue;
			const dist = Math.abs(target.time - edge);
			if (dist < bestDist) {
				bestDist = dist;
				best = { shift: target.time - edge, at: target.time };
			}
		}
	}
	if (beatSec > 0) {
		for (const edge of edges) {
			const beat = Math.round(edge / beatSec) * beatSec;
			const dist = Math.abs(beat - edge);
			if (dist < bestDist) {
				bestDist = dist;
				best = { shift: beat - edge, at: beat };
			}
		}
	}
	return best;
}

/** Whether one of `edges` sits on `at` — the guide is only honest when the
 * snapped edge actually got there, and a neighbour can stop it short. */
export function landedAt(edges: number[], at: number): boolean {
	return edges.some((e) => Math.abs(e - at) < 1e-6);
}
