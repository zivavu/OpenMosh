export type SlideshowMoshMode = 'random' | 'consistent' | 'smooth' | 'per-image';

export type BeatSubdivision = 0.0625 | 0.125 | 0.25 | 0.5 | 1 | 2 | 4;

export type TransitionType = 'crossfade' | 'wipe-left' | 'wipe-down' | 'zoom' | 'pixelate' | 'glitch';

export interface SlideshowSlide {
	id: string;
	file: File;
	objectUrl: string;
	/** Index into the presets array — only used in 'per-image' mode. */
	presetIndex: number | null;
}

export interface SlideshowConfig {
	bpm: number;
	/** Seconds offset to the first beat (from BPM detection). */
	beatOffset: number;
	/** How many beats per image flash. 1 = every beat, 0.5 = every half-beat, 2 = every 2 beats. */
	subdivision: BeatSubdivision;
	moshMode: SlideshowMoshMode;
	moshMin: number;
	moshMax: number;
	moshAudioLink: boolean;
	loop: boolean;
	enabledTransitions: TransitionType[];
	/** Fraction of beat duration for transition (0.1–0.8). */
	transitionDuration: number;
}

export const DEFAULT_SLIDESHOW_CONFIG: SlideshowConfig = {
	bpm: 120,
	beatOffset: 0,
	subdivision: 1,
	moshMode: 'random',
	moshMin: 2,
	moshMax: 5,
	moshAudioLink: false,
	loop: true,
	enabledTransitions: [],
	transitionDuration: 0.3,
};
