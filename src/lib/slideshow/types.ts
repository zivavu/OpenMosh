export type SlideshowMoshMode = 'random' | 'consistent' | 'smooth' | 'per-image';

export type BeatSubdivision = 0.25 | 0.5 | 1 | 2 | 4;

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
};
