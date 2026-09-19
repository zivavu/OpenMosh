import { chainClipEffectsAt } from "../editor/chain-clip";
import type { MoshOptions } from "../editor/mosh";
import type { EffectInstance } from "../effects/types";
import { clipAt } from "../timeline/clips";
import {
	textClipWeight,
	type TextClip,
	type TextLane,
	type TextStyle,
	type TextTimeline,
} from "./types";

// Clip geometry is lane-shape agnostic and shared with the sequence fx lanes;
// re-exported here so the text timeline keeps importing it from one place.
export {
	addClip,
	clipAt,
	clipRange,
	freeRangeAt,
	moveClip,
	moveClips,
	moveClipsToLane,
	removeClip,
	resizeBoundary,
	resizeClip,
	sortClips,
} from "../timeline/clips";

/** One text layer to draw for a single frame. */
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

/** The chain a text clip contributes at a time — see createTextChainSource. */
export type TextChainSource = (
	clip: TextClip,
	time: number,
) => EffectInstance[];

/**
 * Clip → chain resolver, one per preview and one per export; the same rules
 * as createMediaChainSource. Static clips hand back their own chain; interval
 * clips roll per tick through a bounded cache keyed by seed and mosh options.
 * `clone` serves static chains as cached deep copies, so an export can write
 * per-frame audio-link values without them landing in the clips being edited.
 */
export function createTextChainSource(
	getMoshOptions: () => MoshOptions,
	{ clone = false } = {},
): TextChainSource {
	const cache = new Map<string, EffectInstance[]>();
	return (clip, time) =>
		chainClipEffectsAt(clip, time, cache, clone, getMoshOptions);
}

/**
 * The text layers visible at `time`, in lane order. Preview and export both go
 * through here, so what you scrub past is what gets written out.
 *
 * Without `chains`, every clip contributes its stored chain; anything that
 * draws passes one, or an interval clip renders clean.
 */
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

/** The clip with this id, wherever it sits. Null when nothing is selected. */
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

/** The lane holding this clip — the style panel edits the lane, not the clip. */
export function findTextClipLane(
	timeline: TextTimeline | null | undefined,
	clipId: string | null,
): TextLane | null {
	if (!clipId || !timeline) return null;
	return (
		timeline.lanes.find((l) => l.clips.some((c) => c.id === clipId)) ?? null
	);
}

/** Every effect instance held anywhere in the timeline (for feedback-buffer GC). */
export function allTextEffectIds(
	timeline: TextTimeline | null | undefined,
): string[] {
	if (!timeline) return [];
	const ids: string[] = [];
	for (const lane of timeline.lanes) {
		for (const clip of lane.clips) {
			for (const eff of clip.effects) ids.push(eff.instanceId);
		}
	}
	return ids;
}

/** Apply one edit to every clip in `clipIds`; the same timeline back when
 * none of them is here. */
export function updateTextClips(
	timeline: TextTimeline,
	clipIds: Set<string>,
	fn: (clip: TextClip) => TextClip,
): TextTimeline {
	if (!timeline.lanes.some((l) => l.clips.some((c) => clipIds.has(c.id)))) {
		return timeline;
	}
	return {
		...timeline,
		lanes: timeline.lanes.map((lane) => {
			if (!lane.clips.some((c) => clipIds.has(c.id))) return lane;
			return {
				...lane,
				clips: lane.clips.map((c) => (clipIds.has(c.id) ? fn(c) : c)),
			};
		}),
	};
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

/** Apply a lane edit inside a timeline. */
export function updateLane(
	timeline: TextTimeline,
	laneId: string,
	fn: (lane: TextLane) => TextLane,
): TextTimeline {
	return {
		...timeline,
		lanes: timeline.lanes.map((l) => (l.id === laneId ? fn(l) : l)),
	};
}
