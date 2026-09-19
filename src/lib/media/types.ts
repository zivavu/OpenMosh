import { restoreEffects } from "../effects";
import type { EffectInstance } from "../effects/types";
import {
	cloneChainEffects,
	normalizeChainFields,
	normalizeLaneSettings,
	type ChainClip,
	type LaneSettings,
} from "../editor/chain-clip";
import { cleanEffects } from "../editor/sequence";
import type { TextOverlayBlendMode } from "../text-overlay";
import {
	clipAt,
	clipFadeWeight,
	fitClipsToDuration,
	MIN_CLIP_LENGTH,
	sortClips,
} from "../timeline/clips";

export { MIN_CLIP_LENGTH } from "../timeline/clips";

/** How a layer's media is sized against the frame before its own scale. */
export type MediaFit = "contain" | "cover" | "stretch";

export const MEDIA_FIT_OPTIONS: { label: string; value: MediaFit }[] = [
	{ label: "contain", value: "contain" },
	{ label: "cover", value: "cover" },
	{ label: "stretch", value: "stretch" },
];

/**
 * How a lane's media is placed and composited, independent of when it is on
 * screen — the media counterpart to TextStyle.
 */
export interface MediaStyle {
	/** Centre of the layer, normalized (x: left→right, y: top→bottom). */
	x: number;
	y: number;
	/** Multiplier on the fitted size. 1 = exactly the fit. */
	scale: number;
	/** Per-axis stretch on top of `scale`, so a layer can be squashed without
	 * losing its uniform size. 1 = none. */
	scaleX: number;
	scaleY: number;
	/** Clockwise, in degrees. */
	rotation: number;
	fit: MediaFit;
	/** 0..1, applied by the GL composite. */
	opacity: number;
	blendMode: TextOverlayBlendMode;
	/**
	 * Room around the media for its own effects to spread into, as a fraction of
	 * the media's size on each side. A blur or a glow otherwise stops dead at the
	 * media's edge, because the edge is where the layer's buffer ends.
	 *
	 * Paid for in resolution: the chain renders the media at 1/(1 + 2*bleed) of
	 * the buffer, so a layer drawn near full-frame size softens a little. 0 is
	 * the old behaviour, sharp and hard-edged; 1 gives a margin as wide as the
	 * media and leaves it a third of the buffer. The buffer's own edge is the
	 * ceiling either way — there is no bleed without something to spend on it.
	 */
	bleed: number;
	/**
	 * How much of that margin is a fade rather than a hard edge, 0..1. The room
	 * bleed hands the effects still ends somewhere, and a glow cut off there
	 * draws the rectangle the bleed was meant to hide; this ramps the coverage
	 * out instead. Measured within the margin alone, so it never eats into the
	 * media. Irrelevant, and hidden, at a bleed of 0.
	 */
	bleedFade: number;
}

/**
 * One span of media on a lane. A chain clip (see chain-clip.ts): the effects
 * run on this clip's media alone, so a lane cut in two can mosh each half
 * differently, fill one from a preset and leave the other clean.
 */
export interface MediaClip extends ChainClip {
	/** Seconds into the source the clip starts at. Ignored by image sources. */
	sourceStart: number;
	/**
	 * What this clip draws, when it isn't the lane's own source. Absent means
	 * "whatever the lane says", which is what every clip meant before a lane
	 * could hold more than one image — so a split inherits the source the whole
	 * lane was on and only the halves the user retargets carry one of these.
	 *
	 * The placement stays on the lane, so cutting a lane in two and dropping a
	 * different photo on each half keeps both in the same place on screen.
	 */
	sourceId?: string;
	/**
	 * Fade the layer in over this many seconds from the clip's start, and out
	 * over `fadeOutSec` before its end — each edge on its own, so a layer can
	 * arrive slowly and cut, or the reverse.
	 *
	 * The media counterpart of FxClip.fadeSec, and for the same reason: a
	 * stacked lane has no other side to cross into, so what a clip boundary
	 * needs is the layer arriving rather than popping on. Here it scales the
	 * lane's opacity rather than its effects' parameters.
	 */
	fadeInSec?: number;
	fadeOutSec?: number;
}

/**
 * A media layer: a source from the pool, drawn with the lane's placement and
 * run through the clip's own effect chain before it meets the image. Clips
 * within a lane never overlap, so a lane shows at most one at a time.
 */
export interface MediaLane {
	id: string;
	name: string;
	enabled: boolean;
	/**
	 * Composite before the main chain rather than over the finished frame, so
	 * every image effect distorts this layer too. See TextLane.underEffects for
	 * why this is a flag and not an index.
	 */
	underEffects: boolean;
	/** Order among *all* layers, media and text alike. Higher sits on top. */
	z: number;
	/** Into the media pool. Null on a lane whose source was removed. */
	sourceId: string | null;
	/** Shared by every clip in the lane. */
	style: MediaStyle;
	clips: MediaClip[];
	/** How this lane's auto clips roll and its links follow the music. Absent
	 * = the editor's settings, as on lanes saved before lanes had their own. */
	settings?: LaneSettings;
}

export interface MediaTimeline {
	enabled: boolean;
	lanes: MediaLane[];
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

/** A sanity cap, not a frame budget: each lane is a full-frame buffer and video
 * lanes each hold a decoder, but the preview keeps up with far more than anyone
 * stacks on purpose. */
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
		// The same all-disabled list the main chain starts from, hidden effects
		// respected — an empty chain gives the panel nothing to switch on, which
		// reads as every effect being unavailable on this clip.
		effects: cleanEffects(),
	};
	if (sourceId) clip.sourceId = sourceId;
	return clip;
}

/**
 * How strongly the clip's layer shows at `time` — 1 unless a fade is ramping.
 * Multiplied into the lane's opacity by the resolver.
 */
export function mediaClipWeight(clip: MediaClip, time: number): number {
	return clipFadeWeight(clip, clip.fadeInSec, clip.fadeOutSec, time);
}

/**
 * Cut the clip covering `at` into two. The right half picks up the source time
 * the left half reached, so splitting a video clip doesn't rewind it, and both
 * halves keep whatever source the clip was on — retargeting one of them is the
 * next gesture, not something a split should guess at. The chain is deep-copied
 * into each half so editing one no longer touches the other.
 */
export function splitMediaClipAt(lane: MediaLane, at: number): MediaLane {
	const clip = clipAt(lane, at);
	if (!clip) return lane;
	if (at - clip.start < MIN_CLIP_LENGTH || clip.end - at < MIN_CLIP_LENGTH) {
		return lane;
	}
	return {
		...lane,
		clips: sortClips([
			...lane.clips.filter((c) => c.id !== clip.id),
			{
				...clip,
				id: nextId("mclip"),
				end: at,
				effects: cloneChainEffects(clip.effects),
			},
			{
				...clip,
				id: nextId("mclip"),
				start: at,
				sourceStart: clip.sourceStart + (at - clip.start),
				effects: cloneChainEffects(clip.effects),
			},
		]),
	};
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
	};
}

export function createMediaTimeline(
	sourceId: string | null,
	z = 0,
): MediaTimeline {
	return {
		enabled: true,
		lanes: [createMediaLane("Layer 1", sourceId, z)],
	};
}

/**
 * Add an empty lane, named after its position: what goes on it is the user's
 * call, and a clip they never asked for is one they have to trim or delete. `z`
 * comes from the caller: the order spans the text lanes too, which this
 * timeline can't see.
 */
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
		lanes: lanes.map((lane, i) => ({
			id: lane.id ?? nextId("mlane"),
			name: lane.name ?? `Layer ${i + 1}`,
			enabled: lane.enabled !== false,
			// See normalizeTextTimeline: lanes saved against the old chain index
			// carry one of those instead of these two.
			underEffects: lane.underEffects ?? legacyChainIndex(lane) === 0,
			z: typeof lane.z === "number" ? lane.z : i,
			sourceId: lane.sourceId ?? null,
			style: { ...DEFAULT_MEDIA_STYLE, ...(lane.style ?? {}) },
			settings: normalizeLaneSettings(lane.settings),
			clips: (Array.isArray(lane.clips) ? lane.clips : []).map((raw) => {
				const clip = raw as Partial<MediaClip> & { fadeSec?: number };
				// Lanes saved before clips carried their own chain held one for the
				// whole lane: every clip inherits it, a copy each, so the split the
				// user made back then keeps rendering as it did.
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
					...normalizeChainFields(clip, effects),
				};
			}),
		})),
	};
}

/**
 * Pull every lane's clips back inside a timeline that just got shorter. Kept by
 * identity when nothing overhangs, so the editor can run it on every duration
 * change without writing.
 */
export function fitMediaTimeline(
	timeline: MediaTimeline,
	duration: number,
): MediaTimeline {
	if (duration <= 0 || timeline.lanes.length === 0) return timeline;
	const lanes = timeline.lanes.map((lane) =>
		fitClipsToDuration(lane, duration),
	);
	return lanes.some((l, i) => l !== timeline.lanes[i])
		? { ...timeline, lanes }
		: timeline;
}
