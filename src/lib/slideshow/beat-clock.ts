import type { BeatSubdivision, TimelineSegment, ManualSwitchPoint } from './types';

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
	const intervalSeconds = (60 / bpm) * subdivision;
	return {
		intervalSeconds,
		beatAt(t: number) {
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
	/** Whether this exact time lands on a manual switch point. */
	isManualSwitch: boolean;
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
	manualSwitchPoints: ManualSwitchPoint[],
	fallbackSubdivision: BeatSubdivision,
): BeatInfo {
	const adjusted = Math.max(0, t - beatOffset);

	// Check if adjusted lands on a manual switch point (within 1ms tolerance)
	const isManualSwitch = manualSwitchPoints.some(
		(p) => Math.abs(p.time - adjusted) <= 0.001,
	);

	// Find phase origin by walking through manual switch points
	// Each manual switch point resets the phase and counts as 1 beat
	let beatsBeforeOrigin = 0;
	let phaseOrigin = 0;

	// Filter to manual switch points that are at or before adjusted time
	const relevantPoints = manualSwitchPoints.filter((p) => p.time <= adjusted);

	for (let i = 0; i < relevantPoints.length; i++) {
		const intervalStart = i === 0 ? 0 : relevantPoints[i - 1].time;
		const intervalEnd = relevantPoints[i].time;
		const subdivision = getSubdivisionAt(intervalStart, segments, fallbackSubdivision);
		const intervalSeconds = (60 / bpm) * subdivision;
		const intervalDuration = intervalEnd - intervalStart;
		beatsBeforeOrigin += Math.floor(intervalDuration / intervalSeconds);
		// Each manual switch point adds 1 beat (the forced switch)
		beatsBeforeOrigin += 1;
		phaseOrigin = intervalEnd;
	}

	// Compute local beat index and fraction from phase origin
	const activeSubdivision = getSubdivisionAt(adjusted, segments, fallbackSubdivision);
	const activeInterval = (60 / bpm) * activeSubdivision;
	const elapsed = adjusted - phaseOrigin;
	const localBeatIndex = Math.floor(elapsed / activeInterval);
	const fraction = activeInterval > 0 ? (elapsed % activeInterval) / activeInterval : 0;

	return {
		index: beatsBeforeOrigin + localBeatIndex,
		fraction,
		isManualSwitch,
	};
}
