import { chainClipEffectsAt } from "../editor/chain-clip";
import type { MoshOptions } from "../editor/mosh";
import type { EffectInstance } from "../effects/types";
import {
	clipAt,
	replaceClipIn,
	updateClipsIn,
	updateLaneIn,
} from "../timeline/clips";
import {
	createTextTimeline,
	textClipWeight,
	type TextClip,
	type TextLane,
	type TextStyle,
	type TextTimeline,
} from "./types";

// Clip geometry is lane-shape agnostic and shared with the sequence fx lanes;
// re-exported so the text timeline imports it from one place.
export {
	addClip,
	clipAt,
	clipRange,
	freeRangeAt,
	moveClip,
	moveClips,
	removeClip,
	resizeBoundary,
	resizeClip,
	sortClips,
} from "../timeline/clips";

export interface ResolvedTextLayer {
	/** Stable across frames: keys the renderer's texture and feedback caches. */
	key: string;
	laneId: string;
	clipId: string;
	/** Composite before the whole chain, or over the finished frame. */
	underEffects: boolean;
	/** Order among all layers, text and media alike. Higher sits on top. */
	z: number;
	text: string;
	style: TextStyle;
	effects: EffectInstance[];
}

export type TextChainSource = (
	clip: TextClip,
	time: number,
) => EffectInstance[];

/** Clip to chain resolver, one per preview and one per export; same rules as
 * createMediaChainSource. Static clips hand back their own chain; interval
 * clips roll per tick through a cache keyed by seed and mosh options. `clone`
 * serves static chains as deep copies, so export writes don't touch the clips. */
export function createTextChainSource(
	getMoshOptions: () => MoshOptions,
	{ clone = false } = {},
): TextChainSource {
	const cache = new Map<string, EffectInstance[]>();
	return (clip, time) =>
		chainClipEffectsAt(clip, time, cache, clone, getMoshOptions);
}

/** The text layers visible at `time`, in lane order. Preview and export both
 * go through here, so what you scrub past is what gets written out. Without
 * `chains`, every clip contributes its stored chain; anything that draws
 * passes one, or an interval clip renders clean. */
export function resolveTextLayersAt(
	timeline: TextTimeline | null | undefined,
	time: number,
	chains?: TextChainSource,
): ResolvedTextLayer[] {
	if (!timeline?.enabled) return [];
	const layers: ResolvedTextLayer[] = [];
	for (const lane of timeline.lanes) {
		if (!lane.enabled) continue;
		const clip = clipAt(lane, time);
		if (!clip || !clip.text.trim() || lane.style.opacity <= 0) continue;
		// Opacity is applied by the GL composite, not baked into the raster, so
		// a fading clip reuses the lane's texture frame after frame.
		const weight = textClipWeight(clip, time);
		if (weight <= 0) continue;
		layers.push({
			key: clip.id,
			laneId: lane.id,
			clipId: clip.id,
			underEffects: lane.underEffects,
			z: lane.z,
			text: clip.text,
			style:
				weight < 1
					? { ...lane.style, opacity: lane.style.opacity * weight }
					: lane.style,
			effects: chains ? chains(clip, time) : clip.effects,
		});
	}
	return layers;
}

export function findTextClip(
	timeline: TextTimeline | null | undefined,
	clipId: string | null,
): TextClip | null {
	if (!clipId || !timeline) return null;
	for (const lane of timeline.lanes) {
		const clip = lane.clips.find((c) => c.id === clipId);
		if (clip) return clip;
	}
	return null;
}

/** The lane holding this clip: the style panel edits the lane, not the clip. */
export function findTextClipLane(
	timeline: TextTimeline | null | undefined,
	clipId: string | null,
): TextLane | null {
	if (!clipId || !timeline) return null;
	return (
		timeline.lanes.find((l) => l.clips.some((c) => c.id === clipId)) ?? null
	);
}

/** Apply one edit to every clip in `clipIds`; the same timeline back when
 * none of them is here. */
export function updateTextClips(
	timeline: TextTimeline,
	clipIds: Set<string>,
	fn: (clip: TextClip) => TextClip,
): TextTimeline {
	const lanes = updateClipsIn(timeline.lanes, clipIds, fn);
	return lanes === timeline.lanes ? timeline : { ...timeline, lanes };
}

/** Fonts every clip needs, so an export can await them before frame 0. */
export function textTimelineFonts(
	timeline: TextTimeline | null | undefined,
): string[] {
	const families = new Set<string>();
	for (const lane of timeline?.lanes ?? []) {
		families.add(lane.style.fontFamily);
	}
	return [...families];
}

export function updateLane(
	timeline: TextTimeline,
	laneId: string,
	fn: (lane: TextLane) => TextLane,
): TextTimeline {
	return { ...timeline, lanes: updateLaneIn(timeline.lanes, laneId, fn) };
}

export function replaceTextClip(
	timeline: TextTimeline,
	next: TextClip,
): TextTimeline {
	return { ...timeline, lanes: replaceClipIn(timeline.lanes, next) };
}

/** Text on or off. Turning it on with no lanes yet makes the first, at `z`. */
export function toggledTextTimeline(
	timeline: TextTimeline,
	z: number,
): TextTimeline {
	if (timeline.enabled) return { ...timeline, enabled: false };
	if (timeline.lanes.length > 0) return { ...timeline, enabled: true };
	return createTextTimeline(z);
}
