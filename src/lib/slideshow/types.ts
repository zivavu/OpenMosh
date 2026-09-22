export type SlideshowMoshMode =
	"random" | "consistent" | "smooth" | "per-image";

export type BeatSubdivision =
	0 | 0.03125 | 0.0625 | 0.125 | 0.25 | 0.5 | 1 | 2 | 4;

export interface TimelineSegment {
	id: string;
	/** Seconds from audio start. */
	startTime: number;
	/** Optional end (seconds from audio start); null/undefined runs until the
	 * next segment or the end of the track. */
	endTime?: number | null;
	subdivision: BeatSubdivision;
}

export interface SlideshowSlide {
	id: string;
	file: File;
	objectUrl: string;
	/** 100×100 thumbnail blob URL; null until generated. */
	thumbUrl: string | null;
	/** Whether a thumbnail is still coming; see SequenceSource.thumbPending. */
	thumbPending: boolean;
	/** Index into the presets array; only used in 'per-image' mode. */
	presetIndex: number | null;
	kind: "image" | "video";
	/** Video only: intrinsic duration in seconds (probed at add time). */
	duration?: number;
	width?: number;
	height?: number;
	/** ≤1080p stand-in the preview decodes instead of an oversized original
	 * (see video/proxy.ts); absent until the transcode lands. */
	proxyFile?: File;
	/** The proxy's size: what the transcode aims at while running, then what it
	 * turned out to be. Absent until the worker picks one. */
	proxyWidth?: number;
	proxyHeight?: number;
	proxyPending?: boolean;
	/** 0 to 1, while `proxyPending`. */
	proxyProgress?: number;
	/** Transcoding failed; previews stay on the original. */
	proxyFailed?: boolean;
	proxyReason?: string;
	/** User asked this video to preview from the original (see
	 * video/proxy-preference.ts); only set where a proxy would otherwise be built. */
	proxyDisabled?: boolean;
}

import { EMPTY_TEXT_TIMELINE, type TextTimeline } from "../text";

export interface SlideshowConfig {
	bpm: number;
	/** Seconds offset to the first beat (from BPM detection). */
	beatOffset: number;
	/** Beats per image flash: 1 = every beat, 0.5 = half-beat, 2 = every 2 beats. */
	subdivision: BeatSubdivision;
	moshMode: SlideshowMoshMode;
	moshMin: number;
	moshMax: number;
	/** Effects toggled per beat in smooth mode (1 = slow drift, 5 = fast churn). */
	smoothSpeed: number;
	moshAudioLink: boolean;
	/** 0 to 1: probability and range width of random audio links. */
	moshAudioLinkStrength: number;
	loop: boolean;
	segments: TimelineSegment[];
	/** Optional timed text lanes, keyed to audio time. */
	text: TextTimeline;
	/** Persisted alongside the config; the live value lives on the AudioManager. */
	outputVolume: number;
}

export const DEFAULT_SLIDESHOW_CONFIG: SlideshowConfig = {
	bpm: 120,
	beatOffset: 0,
	subdivision: 1,
	moshMode: "random",
	moshMin: 2,
	moshMax: 5,
	smoothSpeed: 1,
	moshAudioLink: false,
	moshAudioLinkStrength: 0.8,
	loop: true,
	segments: [],
	text: { ...EMPTY_TEXT_TIMELINE },
	outputVolume: 1,
};
