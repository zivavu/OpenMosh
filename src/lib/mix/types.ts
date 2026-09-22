import {
	fitClipsToDuration,
	MIN_CLIP_LENGTH,
	sortClips,
	type TimelineClip,
} from "../timeline/clips";

/** Audio sources that live in the track library rather than the media pool. */
export const TRACK_SOURCE_PREFIX = "track:";

export function trackSourceId(trackId: string): string {
	return TRACK_SOURCE_PREFIX + trackId;
}

/** The library id behind a `track:` source, or null for a pool source. */
export function trackIdOf(sourceId: string): string | null {
	return sourceId.startsWith(TRACK_SOURCE_PREFIX)
		? sourceId.slice(TRACK_SOURCE_PREFIX.length)
		: null;
}

/** Linear gain the volume controls reach: +6 dB of headroom over unity. */
export const MAX_GAIN = 2;

/** One span of sound on an audio lane. */
export interface AudioClip extends TimelineClip {
	/** Seconds into the source the clip starts at. */
	sourceStart: number;
	/** A pool source (a video's own audio) or a `track:` library source. */
	sourceId: string | null;
	/** Linear, 1 = as recorded. Absent means 1. */
	gain?: number;
	fadeInSec?: number;
	fadeOutSec?: number;
}

export interface AudioLane {
	id: string;
	name: string;
	/** Off mutes the lane. */
	enabled: boolean;
	gain: number;
	/** Whether this lane's sound feeds the audio links: what the effects react to. */
	drives: boolean;
	clips: AudioClip[];
}

/** How a media lane's videos sound. The picture and its audio share one clip. */
export interface LaneAudio {
	muted: boolean;
	gain: number;
	drives: boolean;
}

export const DEFAULT_LANE_AUDIO: LaneAudio = {
	muted: false,
	gain: 1,
	drives: false,
};

/** Lanes saved before they carried sound stay silent, so an old project sounds as it did. */
export const LEGACY_LANE_AUDIO: LaneAudio = {
	...DEFAULT_LANE_AUDIO,
	muted: true,
};

export const MAX_AUDIO_LANES = 12;

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createAudioClip(
	start: number,
	end: number,
	sourceId: string | null,
	sourceStart = 0,
): AudioClip {
	return { id: nextId("aclip"), start, end, sourceStart, sourceId };
}

export function createAudioLane(name: string, drives = false): AudioLane {
	return {
		id: nextId("alane"),
		name,
		enabled: true,
		gain: 1,
		drives,
		clips: [],
	};
}

/** Cut the clip covering `at` into two; the right half picks up where the left stopped. */
export function splitAudioClipAt(lane: AudioLane, at: number): AudioLane {
	const clip = lane.clips.find((c) => at > c.start && at < c.end);
	if (!clip) return lane;
	if (at - clip.start < MIN_CLIP_LENGTH || clip.end - at < MIN_CLIP_LENGTH) {
		return lane;
	}
	const left: AudioClip = { ...clip, end: at, fadeOutSec: undefined };
	const right: AudioClip = {
		...clip,
		id: nextId("aclip"),
		start: at,
		sourceStart: clip.sourceStart + (at - clip.start),
		fadeInSec: undefined,
	};
	return {
		...lane,
		clips: sortClips([
			...lane.clips.filter((c) => c.id !== clip.id),
			left,
			right,
		]),
	};
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function normalizeAudioLanes(raw: unknown): AudioLane[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((lane: Partial<AudioLane>, i) => ({
		id: lane.id ?? nextId("alane"),
		name: lane.name ?? `Audio ${i + 1}`,
		enabled: lane.enabled !== false,
		gain: num(lane.gain, 1),
		drives: !!lane.drives,
		clips: (Array.isArray(lane.clips) ? lane.clips : []).map(
			(c: Partial<AudioClip>) => ({
				id: c.id ?? nextId("aclip"),
				start: num(c.start, 0),
				end: num(c.end, 0),
				sourceStart: num(c.sourceStart, 0),
				sourceId: c.sourceId ?? null,
				gain: c.gain,
				fadeInSec: c.fadeInSec,
				fadeOutSec: c.fadeOutSec,
			}),
		),
	}));
}

export function normalizeLaneAudio(raw: unknown): LaneAudio {
	if (!raw || typeof raw !== "object") return { ...LEGACY_LANE_AUDIO };
	const a = raw as Partial<LaneAudio>;
	return {
		muted: !!a.muted,
		gain: num(a.gain, 1),
		drives: !!a.drives,
	};
}

export function fitAudioLanes(
	lanes: AudioLane[],
	duration: number,
): AudioLane[] {
	const next = lanes.map((lane) => fitClipsToDuration(lane, duration));
	return next.some((l, i) => l !== lanes[i]) ? next : lanes;
}

/** Point every clip on `from` at `to`, e.g. when the song is swapped. */
export function retargetAudioSource(
	lanes: AudioLane[],
	from: string,
	to: string,
): AudioLane[] {
	return lanes.map((lane) =>
		lane.clips.some((c) => c.sourceId === from)
			? {
					...lane,
					clips: lane.clips.map((c) =>
						c.sourceId === from ? { ...c, sourceId: to } : c,
					),
				}
			: lane,
	);
}

/** Drop every clip playing `sourceId`; lanes left empty go too. */
export function removeAudioSource(
	lanes: AudioLane[],
	sourceId: string,
): AudioLane[] {
	if (!lanes.some((l) => l.clips.some((c) => c.sourceId === sourceId))) {
		return lanes;
	}
	return lanes
		.map((lane) => ({
			...lane,
			clips: lane.clips.filter((c) => c.sourceId !== sourceId),
		}))
		.filter((lane) => lane.clips.length > 0);
}

/** Sources the audio lanes reference, pool and library alike. */
export function audioLaneSourceIds(lanes: AudioLane[] | undefined): string[] {
	const ids = new Set<string>();
	for (const lane of lanes ?? []) {
		for (const clip of lane.clips) if (clip.sourceId) ids.add(clip.sourceId);
	}
	return [...ids];
}

/** The latest clip end on any audio lane. */
export function audioLanesEnd(lanes: AudioLane[] | undefined): number {
	let end = 0;
	for (const lane of lanes ?? []) {
		for (const clip of lane.clips) end = Math.max(end, clip.end);
	}
	return end;
}
