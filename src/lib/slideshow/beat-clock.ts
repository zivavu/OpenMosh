import type { BeatSubdivision } from './types';

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
