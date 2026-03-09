export type SlideshowMoshMode =
	| 'random'
	| 'consistent'
	| 'smooth'
	| 'per-image';

export type BeatSubdivision = 0 | 0.03125 | 0.0625 | 0.125 | 0.25 | 0.5 | 1 | 2 | 4;

export interface TimelineSegment {
	id: string;
	/** Seconds from audio start where this segment begins. */
	startTime: number;
	/**
	 * Optional end time (seconds from audio start).
	 * If null/undefined, the segment is treated as open-ended and
	 * applies until the next segment or the end of the track.
	 */
	endTime?: number | null;
	subdivision: BeatSubdivision;
}

export interface SlideshowSlide {
	id: string;
	file: File;
	objectUrl: string;
	/** Index into the presets array — only used in 'per-image' mode. */
	presetIndex: number | null;
}

import type { TextOverlayConfig } from '../text-overlay';

export interface SlideshowConfig {
	bpm: number;
	/** Seconds offset to the first beat (from BPM detection). */
	beatOffset: number;
	/** How many beats per image flash. 1 = every beat, 0.5 = every half-beat, 2 = every 2 beats. */
	subdivision: BeatSubdivision;
	moshMode: SlideshowMoshMode;
	moshMin: number;
	moshMax: number;
	/** How many effects are toggled per beat in smooth mode (1 = slow drift, 5 = fast churn). */
	smoothSpeed: number;
	moshAudioLink: boolean;
	/** 0–1: controls probability and range width of random audio links. */
	moshAudioLinkStrength: number;
	loop: boolean;
	segments: TimelineSegment[];
	/** Text overlay (phrases from dictionary, per beat/frame). */
	textOverlay: TextOverlayConfig;
}

import { DEFAULT_TEXT_OVERLAY_CONFIG } from '../text-overlay';

export const DEFAULT_SLIDESHOW_CONFIG: SlideshowConfig = {
	bpm: 120,
	beatOffset: 0,
	subdivision: 1,
	moshMode: 'random',
	moshMin: 2,
	moshMax: 5,
	smoothSpeed: 1,
	moshAudioLink: false,
	moshAudioLinkStrength: 0.8,
	loop: true,
	segments: [],
	textOverlay: { ...DEFAULT_TEXT_OVERLAY_CONFIG },
};
