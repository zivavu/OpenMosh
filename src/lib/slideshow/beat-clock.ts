import type { BeatSubdivision, TimelineSegment } from './types';

export interface BeatClock {
	/** Duration of one flash interval in seconds. */
	intervalSeconds: number;
	/** Returns the beat index and fractional progress at time t (seconds from start). */
	beatAt(t: number): { index: number; fraction: number };
}

export function createBeatClock(
	bpm: number,
	subdivision: BeatSubdivision,
	offset = 0,
): BeatClock {
	const intervalSeconds = subdivision === 0 ? Infinity : (60 / bpm) * subdivision;
	return {
		intervalSeconds,
		beatAt(t: number) {
			if (subdivision === 0) return { index: Number.MAX_SAFE_INTEGER, fraction: 0 };
			const adjusted = Math.max(0, t - offset);
			const index = Math.floor(adjusted / intervalSeconds);
			const fraction = (adjusted % intervalSeconds) / intervalSeconds;
			return { index, fraction };
		},
	};
}

export interface BeatInfo {
	/** Global beat index (cumulative across all segments/manual points). */
	index: number;
	/** 0–1 fractional progress through the current beat interval. */
	fraction: number;
}

function getSubdivisionAt(
	t: number,
	segments: TimelineSegment[],
	fallback: BeatSubdivision,
): BeatSubdivision {
	let active: BeatSubdivision | null = null;
	for (const seg of segments) {
		const end = seg.endTime ?? Infinity;
		if (seg.startTime <= t && t < end) {
			active = seg.subdivision;
		}
	}
	return active ?? fallback;
}

export function beatAtTime(
	t: number,
	bpm: number,
	beatOffset: number,
	segments: TimelineSegment[],
	fallbackSubdivision: BeatSubdivision,
): BeatInfo {
	const adjusted = Math.max(0, t - beatOffset);
	const activeSubdivision = getSubdivisionAt(t, segments, fallbackSubdivision);
	if (activeSubdivision === 0) return { index: Number.MAX_SAFE_INTEGER, fraction: 0 };
	const activeInterval = (60 / bpm) * activeSubdivision;
	const index = Math.floor(adjusted / activeInterval);
	const fraction = activeInterval > 0 ? (adjusted % activeInterval) / activeInterval : 0;
	return { index, fraction };
}
