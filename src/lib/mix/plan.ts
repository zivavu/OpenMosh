/** What the mix plays, worked out once from the timeline: a flat list of segments
 * that the live mixer and the export render schedule the same way. */

import type { MediaTimeline } from "../media/types";
import {
	sourceSpeed,
	sourceTimeAt,
	type SourceEdit,
} from "../media/source-edit";
import { clipFadeWeight } from "../timeline/clips";
import { trackIdOf } from "./types";

export interface MixInput {
	timeline: MediaTimeline;
	edits: Record<string, SourceEdit>;
	/** Pool videos by id, with their length: they wrap, the way the picture does.
	 * Images and ids missing here are silent. */
	videos: Record<string, number>;
	/** Extra gain per source, e.g. the song's loudness normalization. */
	sourceGains?: Record<string, number>;
	/** Library tracks' lengths, once decoded: what a looping clip wraps at. */
	tracks?: Record<string, number>;
}

/** The clip a segment belongs to, for its fade envelope. */
export interface MixFade {
	start: number;
	end: number;
	fadeIn: number;
	fadeOut: number;
}

export interface MixSegment {
	laneId: string;
	clipId: string;
	sourceId: string;
	/** Feeds the audio links. */
	drives: boolean;
	/** Timeline seconds the segment covers. */
	start: number;
	end: number;
	/** Source seconds at `start`. */
	offset: number;
	rate: number;
	/** Clip × source gain, before the fade. */
	gain: number;
	fade: MixFade;
}

/** Below this a segment isn't worth a node. */
const MIN_SEGMENT = 0.001;
/** A loop this short would cut the clip into thousands of segments; it plays straight. */
const MIN_LOOP = 0.02;

interface Walk {
	start: number;
	end: number;
	/** Source seconds at the clip's start. */
	from: number;
	rate: number;
	/** The stretch the source wraps inside, or null when it plays once. */
	loop: { start: number; end: number } | null;
}

/** The clip's run through its source, cut wherever the source wraps. */
function walkClip(w: Walk): { start: number; end: number; offset: number }[] {
	const out: { start: number; end: number; offset: number }[] = [];
	const loop = w.loop && w.loop.end - w.loop.start >= MIN_LOOP ? w.loop : null;
	if (!loop || w.rate <= 0) {
		if (w.end - w.start >= MIN_SEGMENT)
			out.push({ start: w.start, end: w.end, offset: w.from });
		return out;
	}
	let t = w.start;
	let p = w.from;
	while (w.end - t >= MIN_SEGMENT) {
		const until = Math.min(w.end, t + (loop.end - p) / w.rate);
		if (until - t >= MIN_SEGMENT) out.push({ start: t, end: until, offset: p });
		// A source already at its end would never advance otherwise.
		t = Math.max(until, t + MIN_SEGMENT);
		p = loop.start;
	}
	return out;
}

/** How a pool video's sound runs for a clip: the same walk the picture takes. */
function videoWalk(
	edit: SourceEdit | undefined,
	length: number,
	clip: { start: number; end: number; sourceStart: number },
): Walk {
	const span = edit?.span;
	const loop = span
		? { start: span.start, end: span.end }
		: { start: 0, end: length };
	const raw = sourceTimeAt(edit, 0, clip.sourceStart);
	const len = loop.end - loop.start;
	const from =
		len > 0 ? loop.start + ((((raw - loop.start) % len) + len) % len) : raw;
	return {
		start: clip.start,
		end: clip.end,
		from,
		rate: sourceSpeed(edit),
		loop,
	};
}

export function planMix(input: MixInput): MixSegment[] {
	const { timeline, edits, videos, sourceGains = {}, tracks = {} } = input;
	const out: MixSegment[] = [];
	const push = (
		laneId: string,
		clip: {
			id: string;
			start: number;
			end: number;
			fadeInSec?: number;
			fadeOutSec?: number;
		},
		sourceId: string,
		drives: boolean,
		gain: number,
		walk: Walk,
	) => {
		const total = gain * (sourceGains[sourceId] ?? 1);
		if (!(total > 0)) return;
		const fade: MixFade = {
			start: clip.start,
			end: clip.end,
			fadeIn: clip.fadeInSec ?? 0,
			fadeOut: clip.fadeOutSec ?? 0,
		};
		for (const piece of walkClip(walk)) {
			out.push({
				laneId,
				clipId: clip.id,
				sourceId,
				drives,
				...piece,
				rate: walk.rate,
				gain: total,
				fade,
			});
		}
	};

	for (const lane of timeline.lanes) {
		const audio = lane.audio;
		if (!lane.enabled || !audio || audio.muted) continue;
		for (const clip of lane.clips) {
			if (clip.audioDetached) continue;
			const sourceId = clip.sourceId ?? lane.sourceId;
			const length = sourceId ? videos[sourceId] : undefined;
			if (!sourceId || !length) continue;
			push(
				lane.id,
				clip,
				sourceId,
				audio.drives,
				clip.gain ?? 1,
				videoWalk(edits[sourceId], length, clip),
			);
		}
	}

	for (const lane of timeline.audioLanes ?? []) {
		if (!lane.enabled) continue;
		for (const clip of lane.clips) {
			const sourceId = clip.sourceId;
			if (!sourceId) continue;
			const gain = clip.gain ?? 1;
			const length = videos[sourceId];
			if (length) {
				// A video's sound keeps the picture's speed and wrap even once detached.
				push(
					lane.id,
					clip,
					sourceId,
					lane.drives,
					gain,
					videoWalk(edits[sourceId], length, clip),
				);
			} else if (trackIdOf(sourceId)) {
				const trackLength = tracks[sourceId] ?? 0;
				const loops = clip.loop && trackLength > 0;
				push(lane.id, clip, sourceId, lane.drives, gain, {
					start: clip.start,
					end: clip.end,
					from: loops ? clip.sourceStart % trackLength : clip.sourceStart,
					rate: 1,
					loop: loops ? { start: 0, end: trackLength } : null,
				});
			}
		}
	}
	return out;
}

/** The part of a segment inside [from, to), with the offset moved to match. */
export function trimSegment(
	seg: MixSegment,
	from: number,
	to: number,
): MixSegment | null {
	const start = Math.max(seg.start, from);
	const end = Math.min(seg.end, to);
	if (end - start < MIN_SEGMENT) return null;
	return {
		...seg,
		start,
		end,
		offset: seg.offset + (start - seg.start) * seg.rate,
	};
}

/** The fade ramps as they actually run: shrunk to meet when they outlast the clip. */
function fadeLengths(fade: MixFade): [number, number] {
	let fadeIn = Math.max(0, fade.fadeIn);
	let fadeOut = Math.max(0, fade.fadeOut);
	const length = fade.end - fade.start;
	if (length > 0 && fadeIn + fadeOut > length) {
		const scale = length / (fadeIn + fadeOut);
		fadeIn *= scale;
		fadeOut *= scale;
	}
	return [fadeIn, fadeOut];
}

/** Gain breakpoints across a segment; linear ramps between them reproduce the fade. */
export function segmentEnvelope(
	seg: MixSegment,
): { t: number; gain: number }[] {
	const [fadeIn, fadeOut] = fadeLengths(seg.fade);
	const times = [seg.start, seg.end];
	if (fadeIn > 0) times.push(seg.fade.start + fadeIn);
	if (fadeOut > 0) times.push(seg.fade.end - fadeOut);
	const inside = [...new Set(times)]
		.filter((t) => t >= seg.start && t <= seg.end)
		.sort((a, b) => a - b);
	const span = { id: seg.clipId, start: seg.fade.start, end: seg.fade.end };
	return inside.map((t) => ({
		t,
		gain: seg.gain * clipFadeWeight(span, seg.fade.fadeIn, seg.fade.fadeOut, t),
	}));
}

/** Every source the plan needs audio for. */
export function planSourceIds(plan: MixSegment[]): string[] {
	return [...new Set(plan.map((s) => s.sourceId))];
}
