/** What the mix plays, worked out once from the timeline: a flat list of segments
 * that the live mixer and the export render schedule the same way. */

import type { MediaTimeline } from "../media/types";
import {
	clipSourcePosition,
	sourceSpan,
	sourceSpeed,
	type SourceEdit,
} from "../media/source-edit";
import { clipBounceWalk } from "../media/types";
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
	/** Plays the source backward from `offset`: a bouncing clip's return pass. */
	reversed?: boolean;
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
	/** Turns at the loop's ends instead of wrapping; `back` starts it backward. */
	bounce?: { back: boolean };
}

interface WalkPiece {
	start: number;
	end: number;
	offset: number;
	reversed?: boolean;
}

/** The clip's run through its source, cut wherever the source wraps or turns. */
function walkClip(w: Walk): WalkPiece[] {
	const out: WalkPiece[] = [];
	const loop = w.loop && w.loop.end - w.loop.start >= MIN_LOOP ? w.loop : null;
	if (loop && w.bounce && w.rate > 0) {
		let t = w.start;
		let p = w.from;
		let back = w.bounce.back;
		while (w.end - t >= MIN_SEGMENT) {
			const room = back ? p - loop.start : loop.end - p;
			const until = Math.min(w.end, t + room / w.rate);
			if (until - t >= MIN_SEGMENT) {
				out.push({
					start: t,
					end: until,
					offset: p,
					reversed: back || undefined,
				});
			}
			t = Math.max(until, t + MIN_SEGMENT);
			p = back ? loop.start : loop.end;
			back = !back;
		}
		return out;
	}
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

/** A clip as the sound walks it. */
interface WalkedClip {
	start: number;
	end: number;
	sourceStart: number;
	bounce?: boolean;
	bounceBack?: boolean;
}

/** How a pool video's sound runs for a clip: the same walk the picture takes, or,
 * unlooped, one pass that stops where the source runs out. A bouncing clip turns at
 * either end whether looped or not. */
function videoWalk(
	edit: SourceEdit | undefined,
	length: number,
	clip: WalkedClip,
	loops = true,
): Walk {
	const span = sourceSpan(edit, length);
	const loop = { start: span.start, end: span.end };
	const bounce = clipBounceWalk(clip, length);
	const at = clipSourcePosition(edit, 0, clip.sourceStart, bounce);
	const len = loop.end - loop.start;
	const from =
		len > 0 && !bounce
			? loop.start + ((((at.time - loop.start) % len) + len) % len)
			: at.time;
	const rate = sourceSpeed(edit);
	if (bounce) {
		return {
			start: clip.start,
			end: clip.end,
			from,
			rate,
			loop,
			bounce: { back: at.back },
		};
	}
	if (!loops) {
		const runsOut = rate > 0 ? clip.start + (loop.end - from) / rate : clip.end;
		return {
			start: clip.start,
			end: Math.min(clip.end, runsOut),
			from,
			rate,
			loop: null,
		};
	}
	return { start: clip.start, end: clip.end, from, rate, loop };
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
				// A detached video's sound keeps the picture's speed; it wraps only when looped.
				push(
					lane.id,
					clip,
					sourceId,
					lane.drives,
					gain,
					videoWalk(edits[sourceId], length, clip, !!clip.loop),
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

/** Timeline times inside a video clip where its source starts over. */
export function videoClipRepeats(
	edit: SourceEdit | undefined,
	length: number,
	clip: WalkedClip,
	loops = true,
): number[] {
	if (!(length > 0) || (!loops && !clip.bounce)) return [];
	return walkClip(videoWalk(edit, length, clip, loops))
		.slice(1)
		.map((s) => s.start);
}

/** The same for a looping library track, `length` seconds long. */
export function trackClipRepeats(
	clip: { start: number; end: number; sourceStart: number },
	length: number,
): number[] {
	if (!(length > 0)) return [];
	return walkClip({
		start: clip.start,
		end: clip.end,
		from: clip.sourceStart % length,
		rate: 1,
		loop: { start: 0, end: length },
	})
		.slice(1)
		.map((s) => s.start);
}

/** More than any snap needs; a tiny loop over a long project would list thousands. */
const MAX_SOURCE_ENDS = 200;

/** Where a video clip's media runs out and starts over, measured as if the clip ran
 * to `until`: what its end snaps to while being dragged longer or shorter. */
export function videoSourceEnds(
	edit: SourceEdit | undefined,
	length: number,
	clip: Omit<WalkedClip, "end">,
	until: number,
	loops = true,
): number[] {
	if (!loops && !clip.bounce) {
		if (!(length > 0)) return [];
		const end = videoWalk(edit, length, { ...clip, end: Infinity }, false).end;
		return end > clip.start && Number.isFinite(end) ? [end] : [];
	}
	return videoClipRepeats(edit, length, { ...clip, end: until }, loops).slice(
		0,
		MAX_SOURCE_ENDS,
	);
}

/** The same for a library track: once where it ends, or at every restart when it loops. */
export function trackSourceEnds(
	clip: { start: number; sourceStart: number; loop?: boolean },
	length: number,
	until: number,
): number[] {
	if (!(length > 0)) return [];
	if (clip.loop) {
		return trackClipRepeats({ ...clip, end: until }, length).slice(
			0,
			MAX_SOURCE_ENDS,
		);
	}
	const end = clip.start + length - clip.sourceStart;
	return end > clip.start ? [end] : [];
}

/** Tooltip tail for a clip that repeats: how many times its media plays. */
export function repeatNote(repeats: number[]): string {
	return repeats.length > 0 ? ` — plays ${repeats.length + 1}×` : "";
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
	const walked = (start - seg.start) * seg.rate;
	return {
		...seg,
		start,
		end,
		offset: seg.reversed ? seg.offset - walked : seg.offset + walked,
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
