import type { AudioResponse } from "../audio/auto-range";
import { chainClipEffectsAt, laneMoshOptions } from "../editor/chain-clip";
import type { MoshOptions } from "../editor/mosh";
import type { EffectInstance } from "../effects/types";
import {
	clipAt,
	replaceClipIn,
	updateClipsIn,
	updateLaneIn,
} from "../timeline/clips";
import { sourceTimeAt, type SourceEdit } from "./source-edit";
import {
	resolveConcreteTransition,
	transitionLength,
	type ConcreteTransition,
} from "./transition";
import { audioLaneSourceIds, trackIdOf, type AudioLane } from "../mix/types";
import {
	mediaClipWeight,
	type MediaClip,
	type MediaLane,
	type MediaStyle,
	type MediaTimeline,
} from "./types";

// Clip geometry is shared with the text and fx lanes; re-exported here for one
// import site.
export { addClip, newClipSpan } from "../timeline/clips";

/** One media layer to draw for a single frame. */
export interface ResolvedMediaLayer {
	/** Stable across frames: keys the renderer's layer texture and the lane's feedback
	 * buffers. Keyed by lane, not clip, so a cut doesn't drop the texture. */
	key: string;
	laneId: string;
	/** The clip on screen, whose chain `effects` is (or was rolled from). */
	clipId: string;
	/** Composite before the whole chain, or over the finished frame. */
	underEffects: boolean;
	/** Order among all layers, media and text alike. Higher sits on top. */
	z: number;
	sourceId: string;
	/** Seconds into the source to show. Videos wrap; images ignore it. */
	sourceTime: number;
	style: MediaStyle;
	/** What the composite draws this layer at: the lane's opacity scaled by the clip's
	 * fade. Separate from `style.opacity` so the per-frame value needn't clone. */
	opacity: number;
	effects: EffectInstance[];
	/** The lane's own audio response; absent when it follows the editor's. */
	response?: AudioResponse;
	/** Set while the clip blends in. */
	transition?: ResolvedLayerTransition;
}

/** What one texture on a lane shows: the clip on screen, or the one blending out. */
export interface MediaLayerSide {
	key: string;
	clipId: string;
	sourceId: string;
	sourceTime: number;
	effects: EffectInstance[];
}

export interface ResolvedLayerTransition {
	/** The clip before, still playing on; null when blending in from nothing. */
	from: MediaLayerSide | null;
	concrete: ConcreteTransition;
	/** 0 at the clip's start, 1 once the blend is done. */
	progress: number;
	seed: number;
}

/** Every texture the layers need this frame, outgoing sides included. */
export function mediaLayerSides(
	layers: ResolvedMediaLayer[],
): MediaLayerSide[] {
	const sides: MediaLayerSide[] = [];
	for (const layer of layers) {
		sides.push(layer);
		if (layer.transition?.from) sides.push(layer.transition.from);
	}
	return sides;
}

/** A lane's second texture, which a clip blending in draws into. */
export function altLayerKey(laneId: string): string {
	return laneId + "#b";
}

/** The texture key each clip draws into. A blend needs both clips live at once, so the
 * key flips at every transition from an adjacent clip; a plain cut keeps it. */
function laneClipKey(lane: MediaLane, index: number): string {
	let alt = false;
	for (let i = 1; i <= index; i++) {
		if (blendsFrom(lane, i)) alt = !alt;
	}
	return alt ? altLayerKey(lane.id) : lane.id;
}

/** The clip right before the one at `index`, when the two touch. */
function adjacentBefore(lane: MediaLane, index: number): MediaClip | null {
	const prev = lane.clips[index - 1];
	const clip = lane.clips[index];
	return prev && clip && clip.start - prev.end < ADJACENT_EPS ? prev : null;
}

function blendsFrom(lane: MediaLane, index: number): boolean {
	const clip = lane.clips[index];
	return (
		!!clip &&
		transitionLength(clip) > 0 &&
		!!adjacentBefore(lane, index) &&
		!!clipSourceId(lane, lane.clips[index - 1])
	);
}

/** Clips closer than this count as touching. */
const ADJACENT_EPS = 1e-3;

/** What a clip draws: its own source when retargeted, the lane's otherwise. */
export function clipSourceId(
	lane: MediaLane,
	clip: MediaClip | null | undefined,
): string | null {
	return clip?.sourceId ?? lane.sourceId;
}

/** Distinct sources a lane's clips can call for, the lane's own included. */
export function laneSourceIds(lane: MediaLane): string[] {
	const ids = new Set<string>();
	for (const clip of lane.clips) {
		const id = clipSourceId(lane, clip);
		if (id) ids.add(id);
	}
	return [...ids];
}

/** The chain a media clip contributes at a time; see createMediaChainSource. */
export type MediaChainSource = (
	lane: MediaLane,
	clip: MediaClip,
	time: number,
) => EffectInstance[];

/** Clip → chain resolver, one per preview and one per export. Static clips hand
 * back their own chain; interval clips roll per tick through a cache. */
export function createMediaChainSource(
	getMoshOptions: () => MoshOptions,
	{ clone = false } = {},
): MediaChainSource {
	const cache = new Map<string, EffectInstance[]>();
	// Each lane rolls under its own settings, so an auto clip never borrows another's.
	return (lane, clip, time) =>
		chainClipEffectsAt(clip, time, cache, clone, () =>
			laneMoshOptions(lane, getMoshOptions()),
		);
}

/** The media layers visible at `time`, in lane order. Preview and export both go
 * through here. Without `chains`, every clip contributes its stored chain. */
export function resolveMediaLayersAt(
	timeline: MediaTimeline | null | undefined,
	time: number,
	/** Per-source edits, for the rate each clip walks its media at. */
	edits?: Record<string, SourceEdit>,
	chains?: MediaChainSource,
): ResolvedMediaLayer[] {
	if (!timeline?.enabled) return [];
	const layers: ResolvedMediaLayer[] = [];
	for (const lane of timeline.lanes) {
		if (!lane.enabled || lane.style.opacity <= 0) continue;
		const clip = clipAt(lane, time);
		if (!clip) continue;
		const sourceId = clipSourceId(lane, clip);
		if (!sourceId) continue;
		const index = lane.clips.indexOf(clip);
		const blend = transitionLength(clip);
		const elapsed = time - clip.start;
		let transition: ResolvedLayerTransition | undefined;
		if (blend > 0 && elapsed < blend) {
			const concrete = resolveConcreteTransition(clip.transition!, clip.start);
			const prev = blendsFrom(lane, index) ? lane.clips[index - 1] : null;
			const prevSource = prev && clipSourceId(lane, prev);
			if (concrete) {
				transition = {
					from:
						prev && prevSource
							? {
									key: laneClipKey(lane, index - 1),
									clipId: prev.id,
									sourceId: prevSource,
									sourceTime: sourceTimeAt(
										edits?.[prevSource],
										time - prev.start,
										prev.sourceStart,
									),
									effects: chains ? chains(lane, prev, time) : prev.effects,
								}
							: null,
					concrete,
					progress: elapsed / blend,
					seed: clip.transition!.seed,
				};
			}
		}
		layers.push({
			key: laneClipKey(lane, index),
			laneId: lane.id,
			clipId: clip.id,
			underEffects: lane.underEffects,
			z: lane.z,
			sourceId,
			sourceTime: sourceTimeAt(
				edits?.[sourceId],
				time - clip.start,
				clip.sourceStart,
			),
			style: lane.style,
			opacity: lane.style.opacity * mediaClipWeight(clip, time),
			effects: chains ? chains(lane, clip, time) : clip.effects,
			response: lane.settings?.audioResponse,
			transition,
		});
	}
	return layers;
}

/** The clip with this id, wherever it sits. Null when nothing is selected. */
export function findMediaClip(
	timeline: MediaTimeline | null | undefined,
	clipId: string | null,
): MediaClip | null {
	if (!clipId || !timeline) return null;
	for (const lane of timeline.lanes) {
		const clip = lane.clips.find((c) => c.id === clipId);
		if (clip) return clip;
	}
	return null;
}

/** The lane holding this clip; the panel edits the lane, not the clip. */
export function findMediaClipLane(
	timeline: MediaTimeline | null | undefined,
	clipId: string | null,
): MediaLane | null {
	if (!clipId || !timeline) return null;
	return (
		timeline.lanes.find((l) => l.clips.some((c) => c.id === clipId)) ?? null
	);
}

export function updateMediaClips(
	timeline: MediaTimeline,
	clipIds: Set<string>,
	fn: (clip: MediaClip, lane: MediaLane) => MediaClip,
): MediaTimeline {
	const lanes = updateClipsIn(timeline.lanes, clipIds, fn);
	return lanes === timeline.lanes ? timeline : { ...timeline, lanes };
}

export function replaceMediaClip(
	timeline: MediaTimeline,
	next: MediaClip,
): MediaTimeline {
	return { ...timeline, lanes: replaceClipIn(timeline.lanes, next) };
}

/** Pool source ids the timeline references, so a save can persist just those. */
export function mediaTimelineSourceIds(
	timeline: MediaTimeline | null | undefined,
): string[] {
	const ids = new Set<string>();
	for (const lane of timeline?.lanes ?? []) {
		if (lane.sourceId) ids.add(lane.sourceId);
		for (const clip of lane.clips) {
			if (clip.sourceId) ids.add(clip.sourceId);
		}
	}
	for (const id of audioLaneSourceIds(timeline?.audioLanes)) {
		if (!trackIdOf(id)) ids.add(id);
	}
	return [...ids];
}

/** Point the given clips at `sourceId`. A clip already on its lane's source keeps
 * no override. */
export function setMediaClipSources(
	timeline: MediaTimeline,
	clipIds: string[],
	sourceId: string,
): MediaTimeline {
	const ids = new Set(clipIds);
	if (ids.size === 0) return timeline;
	return {
		...timeline,
		lanes: timeline.lanes.map((lane) => {
			if (!lane.clips.some((c) => ids.has(c.id))) return lane;
			return {
				...lane,
				clips: lane.clips.map((c) =>
					ids.has(c.id)
						? {
								...c,
								sourceId: sourceId === lane.sourceId ? undefined : sourceId,
							}
						: c,
				),
			};
		}),
	};
}

export function updateMediaLane(
	timeline: MediaTimeline,
	laneId: string,
	fn: (lane: MediaLane) => MediaLane,
): MediaTimeline {
	return { ...timeline, lanes: updateLaneIn(timeline.lanes, laneId, fn) };
}

/** Drop a removed source from every lane and clip that pointed at it. A clip loses
 * its override rather than gaining a null one. */
export function detachMediaSource(
	timeline: MediaTimeline,
	sourceId: string,
): MediaTimeline {
	const held = (l: MediaLane) =>
		l.sourceId === sourceId || l.clips.some((c) => c.sourceId === sourceId);
	const heardIn = (l: AudioLane) =>
		l.clips.some((c) => c.sourceId === sourceId);
	const audioLanes = timeline.audioLanes?.some(heardIn)
		? timeline.audioLanes.map((l) =>
				heardIn(l)
					? {
							...l,
							clips: l.clips.map((c) =>
								c.sourceId === sourceId ? { ...c, sourceId: null } : c,
							),
						}
					: l,
			)
		: timeline.audioLanes;
	if (!timeline.lanes.some(held)) {
		return audioLanes === timeline.audioLanes
			? timeline
			: { ...timeline, audioLanes };
	}
	return {
		...timeline,
		audioLanes,
		lanes: timeline.lanes.map((l) => {
			if (!held(l)) return l;
			return {
				...l,
				sourceId: l.sourceId === sourceId ? null : l.sourceId,
				clips: l.clips.map((c) =>
					c.sourceId === sourceId ? { ...c, sourceId: undefined } : c,
				),
			};
		}),
	};
}
