import { restoreEffects } from "../effects";
import type { EffectInstance } from "../effects/types";
import {
	normalizeChainFields,
	normalizeLaneSettings,
	type ChainClip,
	splitChainClipAt,
	type LaneSettings,
} from "../editor/chain-clip";
import { cleanEffects } from "../editor/sequence";
import type { TextOverlayBlendMode } from "../text-overlay";
import { clipFadeWeight, fitClipsToDuration } from "../timeline/clips";
import {
	DEFAULT_LANE_AUDIO,
	fitAudioLanes,
	normalizeAudioLanes,
	normalizeLaneAudio,
	type AudioLane,
	type LaneAudio,
} from "../mix/types";

export { MIN_CLIP_LENGTH } from "../timeline/clips";

/** How a layer's media is sized against the frame before its own scale. */
export type MediaFit = "contain" | "cover" | "stretch";

export const MEDIA_FIT_OPTIONS: { label: string; value: MediaFit }[] = [
	{ label: "contain", value: "contain" },
	{ label: "cover", value: "cover" },
	{ label: "stretch", value: "stretch" },
];

/** How a lane's media is placed and composited, the media counterpart to TextStyle. */
export interface MediaStyle {
	/** Centre of the layer, normalized (x: left→right, y: top→bottom). */
	x: number;
	y: number;
	/** Multiplier on the fitted size. 1 = exactly the fit. */
	scale: number;
	/** Per-axis stretch on top of `scale`. 1 = none. */
	scaleX: number;
	scaleY: number;
	/** Clockwise, in degrees. */
	rotation: number;
	fit: MediaFit;
	/** 0..1, applied by the GL composite. */
	opacity: number;
	blendMode: TextOverlayBlendMode;
	/** Room around the media for its own effects to spread into, as a fraction of the
	 * media's size per side. */
	bleed: number;
	/** How much of that margin is a fade rather than a hard edge, 0..1. Measured
	 * within the margin alone, so it never eats into the media. */
	bleedFade: number;
}

/** One span of media on a lane. A chain clip: the effects run on this clip's media
 * alone, so a lane cut in two can mosh each half differently. */
export interface MediaClip extends ChainClip {
	/** Seconds into the source the clip starts at. Ignored by image sources. */
	sourceStart: number;
	/** What this clip draws when it isn't the lane's own source. Absent = the lane's. */
	sourceId?: string;
	/** Fade the layer in over this many seconds from the clip's start, and out over
	 * `fadeOutSec` before its end. */
	fadeInSec?: number;
	fadeOutSec?: number;
	/** Linear volume of the video's own sound on this clip. Absent means 1. */
	gain?: number;
	/** The sound was moved onto an audio lane, so the clip plays silent. */
	audioDetached?: boolean;
}

/** A media layer: a source from the pool, drawn with the lane's placement and chain. */
export interface MediaLane {
	id: string;
	name: string;
	enabled: boolean;
	/** Composite before the main chain, so every image effect distorts this layer too. */
	underEffects: boolean;
	/** Order among *all* layers, media and text alike. Higher sits on top. */
	z: number;
	/** Into the media pool. Null on a lane whose source was removed. */
	sourceId: string | null;
	style: MediaStyle;
	clips: MediaClip[];
	/** How this lane's auto clips roll and its links follow the music. Absent = defaults. */
	settings?: LaneSettings;
	/** How the lane's videos sound. */
	audio?: LaneAudio;
}

export interface MediaTimeline {
	enabled: boolean;
	lanes: MediaLane[];
	/** Sound-only lanes: music, voice-over, detached video audio. Editor mode only. */
	audioLanes?: AudioLane[];
}

export const DEFAULT_MEDIA_STYLE: MediaStyle = {
	x: 0.5,
	y: 0.5,
	scale: 1,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	fit: "contain",
	opacity: 1,
	blendMode: "normal",
	bleed: 0.25,
	bleedFade: 0.5,
};

export const EMPTY_MEDIA_TIMELINE: MediaTimeline = {
	enabled: false,
	lanes: [],
};

/** A sanity cap, not a frame budget: each lane is a full-frame buffer. */
export const MAX_MEDIA_LANES = 20;

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createMediaClip(
	start: number,
	end: number,
	sourceStart = 0,
	sourceId?: string,
): MediaClip {
	const clip: MediaClip = {
		id: nextId("mclip"),
		start,
		end,
		sourceStart,
		mode: "static",
		label: "clean",
		// The same all-disabled list the main chain starts from, hidden effects respected.
		effects: cleanEffects(),
	};
	if (sourceId) clip.sourceId = sourceId;
	return clip;
}

/** How strongly the clip's layer shows at `time`, 1 unless a fade is ramping. */
export function mediaClipWeight(clip: MediaClip, time: number): number {
	return clipFadeWeight(clip, clip.fadeInSec, clip.fadeOutSec, time);
}

/** Cut the clip covering `at` into two. The right half picks up the source time
 * the left reached. */
export function splitMediaClipAt(lane: MediaLane, at: number): MediaLane {
	return splitChainClipAt(
		lane,
		at,
		() => nextId("mclip"),
		(half, clip) => ({
			...half,
			sourceStart: clip.sourceStart + (at - clip.start),
		}),
	);
}

export function createMediaLane(
	name: string,
	sourceId: string | null = null,
	z = 0,
	style: MediaStyle = DEFAULT_MEDIA_STYLE,
): MediaLane {
	return {
		id: nextId("mlane"),
		name,
		enabled: true,
		underEffects: false,
		z,
		sourceId,
		style: { ...style },
		clips: [],
		audio: { ...DEFAULT_LANE_AUDIO },
	};
}

/** Add an empty lane, named after its position. `z` comes from the caller. */
export function appendMediaLane(
	timeline: MediaTimeline,
	sourceId: string | null,
	z = 0,
): MediaTimeline {
	return {
		...timeline,
		lanes: [
			...timeline.lanes,
			createMediaLane(`Layer ${timeline.lanes.length + 1}`, sourceId, z),
		],
	};
}

/** A clip saved with no chain at all is backfilled, not left switch-less. */
function clipEffects(saved: unknown): EffectInstance[] {
	const hydrated = restoreEffects(saved);
	return hydrated.length > 0 ? hydrated : cleanEffects();
}

function legacyChainIndex(lane: object): number {
	const raw = (lane as { chainIndex?: unknown }).chainIndex;
	return typeof raw === "number" ? raw : Number.MAX_SAFE_INTEGER;
}

/** Fill in anything a saved timeline predates or dropped. */
export function normalizeMediaTimeline(raw: unknown): MediaTimeline {
	if (!raw || typeof raw !== "object") return { ...EMPTY_MEDIA_TIMELINE };
	const t = raw as Partial<MediaTimeline>;
	const lanes = Array.isArray(t.lanes) ? t.lanes : [];
	return {
		enabled: !!t.enabled,
		audioLanes: normalizeAudioLanes(t.audioLanes),
		lanes: lanes.map((lane, i) => ({
			id: lane.id ?? nextId("mlane"),
			name: lane.name ?? `Layer ${i + 1}`,
			enabled: lane.enabled !== false,
			// See normalizeTextTimeline: lanes saved against the old chain index carry one.
			underEffects: lane.underEffects ?? legacyChainIndex(lane) === 0,
			z: typeof lane.z === "number" ? lane.z : i,
			sourceId: lane.sourceId ?? null,
			style: { ...DEFAULT_MEDIA_STYLE, ...(lane.style ?? {}) },
			settings: normalizeLaneSettings(lane.settings),
			audio: normalizeLaneAudio(lane.audio),
			clips: (Array.isArray(lane.clips) ? lane.clips : []).map((raw) => {
				const clip = raw as Partial<MediaClip> & { fadeSec?: number };
				// Lanes saved before clips carried their own chain held one for the whole lane:
				// every clip inherits a copy.
				const legacyChain = (lane as { effects?: unknown }).effects;
				const effects = Array.isArray(clip.effects)
					? clipEffects(clip.effects)
					: clipEffects(legacyChain);
				return {
					id: clip.id ?? nextId("mclip"),
					start: clip.start ?? 0,
					end: clip.end ?? 0,
					sourceStart: clip.sourceStart ?? 0,
					sourceId: clip.sourceId ?? undefined,
					// Saved before the two edges split, `fadeSec` ramped both.
					fadeInSec: clip.fadeInSec ?? clip.fadeSec,
					fadeOutSec: clip.fadeOutSec ?? clip.fadeSec,
					gain: clip.gain,
					audioDetached: clip.audioDetached || undefined,
					...normalizeChainFields(clip, effects),
				};
			}),
		})),
	};
}

/** Pull every lane's clips back inside a timeline that just got shorter. Kept by
 * identity when nothing overhangs. */
export function fitMediaTimeline(
	timeline: MediaTimeline,
	duration: number,
): MediaTimeline {
	if (duration <= 0) return timeline;
	const lanes = timeline.lanes.map((lane) =>
		fitClipsToDuration(lane, duration),
	);
	const audioLanes = timeline.audioLanes
		? fitAudioLanes(timeline.audioLanes, duration)
		: undefined;
	return lanes.some((l, i) => l !== timeline.lanes[i]) ||
		audioLanes !== timeline.audioLanes
		? { ...timeline, lanes, audioLanes }
		: timeline;
}
