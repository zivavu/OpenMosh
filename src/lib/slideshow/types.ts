export type SlideshowMoshMode =
  | "random"
  | "consistent"
  | "smooth"
  | "per-image";

export type BeatSubdivision =
  | 0
  | 0.03125
  | 0.0625
  | 0.125
  | 0.25
  | 0.5
  | 1
  | 2
  | 4;

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
  /** 100×100 thumbnail blob URL for grid display. null until generated. */
  thumbUrl: string | null;
  /** Whether a thumbnail is still coming — see SequenceSource.thumbPending. */
  thumbPending: boolean;
  /** Index into the presets array — only used in 'per-image' mode. */
  presetIndex: number | null;
  kind: "image" | "video";
  /** Video only: intrinsic duration in seconds (probed at add time). */
  duration?: number;
  /** Video only: display dimensions (probed at add time). */
  width?: number;
  height?: number;
  /**
   * ≤1080p stand-in the preview decodes instead of an oversized original
   * (see video/proxy.ts). Absent until the transcode lands; export keeps
   * reading `file` either way.
   */
  proxyFile?: File;
  /**
   * The proxy's size: what the transcode is aiming at while it runs, and what
   * the finished file turned out to be once it lands. Absent until the worker
   * has picked one, which is what the badge reads as "still looking".
   */
  proxyWidth?: number;
  proxyHeight?: number;
  /** A proxy is being built (or looked up in storage) for this slide. */
  proxyPending?: boolean;
  /** 0–1, while `proxyPending`. */
  proxyProgress?: number;
  /** Transcoding failed — the chip shows a warning; previews stay on the original. */
  proxyFailed?: boolean;
  /** Why it failed, for the badge to say something more useful than that it did. */
  proxyReason?: string;
  /**
   * The user asked this video to preview from the original — see
   * video/proxy-preference.ts. Only set on slides a proxy would otherwise be
   * built for, so the badge can treat it as "the choice applies here".
   */
  proxyDisabled?: boolean;
}

import { EMPTY_TEXT_TIMELINE, type TextTimeline } from "../text";

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
