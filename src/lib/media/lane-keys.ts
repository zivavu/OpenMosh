/** Keyframes on a media layer's placement. They belong to the lane, in timeline
 * seconds, so every clip on the layer moves along the same path. */

import {
	easeAtIn,
	keyNear,
	keyTimesOf,
	moveKey,
	normalizeTrack,
	putKeyframe,
	removeKeyframe,
	repeatKeys,
	sampleNumbers,
	setEaseAt,
	type KeyEase,
	type Keyframe,
} from "../keyframes";
import type { MediaLane, MediaStyle } from "./types";

export const PLACEMENT_KEYS = [
	"x",
	"y",
	"scale",
	"scaleX",
	"scaleY",
	"rotation",
	"opacity",
] as const;

export type PlacementKey = (typeof PLACEMENT_KEYS)[number];

export type LaneKeys = Partial<Record<PlacementKey, Keyframe<number>[]>>;

/** More keys than any hand-built track; a save listing more is damaged. */
const MAX_KEYS = 1000;

function tracks(lane: Pick<MediaLane, "keys">): Keyframe<number>[][] {
	return Object.values(lane.keys ?? {}).filter((k) => !!k);
}

export function hasLaneKeys(lane: Pick<MediaLane, "keys">): boolean {
	return tracks(lane).length > 0;
}

export function isPlacementKeyed(
	lane: Pick<MediaLane, "keys">,
	key: PlacementKey,
): boolean {
	return (lane.keys?.[key]?.length ?? 0) > 0;
}

/** The lane's placement at timeline `time`. A lane without keys hands back its style. */
export function laneStyleAt(
	lane: Pick<MediaLane, "keys" | "style">,
	time: number | null | undefined,
): MediaStyle {
	if (time == null || !lane.keys || !hasLaneKeys(lane)) return lane.style;
	const style = { ...lane.style };
	for (const key of PLACEMENT_KEYS) {
		const v = sampleNumbers(lane.keys[key], time);
		if (v !== null) style[key] = v;
	}
	return style;
}

function withTrack(
	lane: MediaLane,
	key: PlacementKey,
	keys: Keyframe<number>[] | null,
): MediaLane {
	const next: LaneKeys = { ...lane.keys };
	if (keys && keys.length > 0) next[key] = keys;
	else delete next[key];
	const { keys: _, ...rest } = lane;
	return Object.keys(next).length > 0 ? { ...rest, keys: next } : rest;
}

/** An edit to the placement at `time`: keyed values get a key there, the rest are
 * written as they are. */
export function setLaneStyleAt(
	lane: MediaLane,
	style: MediaStyle,
	time: number | null | undefined,
): MediaLane {
	if (time == null || !hasLaneKeys(lane)) return { ...lane, style };
	const shown = laneStyleAt(lane, time);
	let next: MediaLane = { ...lane, style: { ...lane.style, ...style } };
	for (const key of PLACEMENT_KEYS) {
		if (!isPlacementKeyed(lane, key)) continue;
		// The stored value stays what it was, so a key only lands where a value moved.
		next.style[key] = lane.style[key];
		if (style[key] === shown[key]) continue;
		next = withTrack(next, key, putKeyframe(lane.keys![key], time, style[key]));
	}
	return next;
}

/** Start animating, key the value shown, take the key there away, or with `clear`
 * stop animating at the value shown. */
export function toggleLaneKey(
	lane: MediaLane,
	key: PlacementKey,
	time: number,
	clear: boolean,
): MediaLane {
	const shown = laneStyleAt(lane, time)[key];
	const keys = lane.keys?.[key];
	const settle = (next: MediaLane, value: number): MediaLane => ({
		...next,
		style: { ...next.style, [key]: value },
	});
	if (!keys?.length) return withTrack(lane, key, putKeyframe([], time, shown));
	if (clear) return settle(withTrack(lane, key, null), shown);
	const hit = keyNear(keys, time);
	if (!hit) return withTrack(lane, key, putKeyframe(keys, time, shown));
	const left = removeKeyframe(keys, hit.t);
	return left.length > 0
		? withTrack(lane, key, left)
		: settle(withTrack(lane, key, null), hit.v);
}

export function laneKeyAt(
	lane: Pick<MediaLane, "keys">,
	key: PlacementKey,
	time: number,
): Keyframe<number> | null {
	return keyNear(lane.keys?.[key], time);
}

export function laneKeyTimes(lane: Pick<MediaLane, "keys">): number[] {
	return keyTimesOf(tracks(lane));
}

export function laneEaseAt(
	lane: Pick<MediaLane, "keys">,
	time: number,
): KeyEase | "mixed" | undefined {
	return easeAtIn(tracks(lane), time);
}

function mapTracks(
	lane: MediaLane,
	map: (keys: Keyframe<number>[]) => Keyframe<number>[],
): MediaLane {
	let next = lane;
	for (const key of PLACEMENT_KEYS) {
		const keys = lane.keys?.[key];
		if (keys) next = withTrack(next, key, map(keys));
	}
	return next;
}

export function moveLaneKeys(
	lane: MediaLane,
	from: number,
	to: number,
): MediaLane {
	return mapTracks(lane, (keys) => moveKey(keys, from, to));
}

export function removeLaneKeysAt(lane: MediaLane, time: number): MediaLane {
	const held = laneStyleAt(lane, time);
	const next = mapTracks(lane, (keys) => removeKeyframe(keys, time));
	// A track left with nothing keeps the value its last key had.
	const style = { ...next.style };
	for (const key of PLACEMENT_KEYS)
		if (isPlacementKeyed(lane, key) && !isPlacementKeyed(next, key))
			style[key] = held[key];
	return { ...next, style };
}

export function setLaneEaseAt(
	lane: MediaLane,
	time: number,
	ease: KeyEase | undefined,
): MediaLane {
	return mapTracks(lane, (keys) => setEaseAt(keys, time, ease));
}

/** The lane's keys from first to last played again and again until `end`. */
export function repeatLaneKeys(lane: MediaLane, end: number): MediaLane {
	const times = laneKeyTimes(lane);
	if (times.length < 2) return lane;
	const first = times[0];
	const span = times[times.length - 1] - first;
	return mapTracks(lane, (keys) => repeatKeys(keys, first, span, end));
}

/** Finite values only, opacity held to 0..1; a lane with no track left has none. */
export function normalizeLaneKeys(raw: unknown): LaneKeys | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: LaneKeys = {};
	for (const key of PLACEMENT_KEYS) {
		const keys = normalizeTrack(
			(raw as Record<string, unknown>)[key],
			(v) => {
				const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
				return key === "opacity" ? Math.min(1, Math.max(0, n)) : n;
			},
			MAX_KEYS,
		);
		if (keys) out[key] = keys;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}
