/** Keyframes on a media layer's placement. They belong to the lane, in timeline
 * seconds, so every clip on the layer moves along the same path. */

import {
	easeAtIn,
	keyNear,
	keyTimesOf,
	normalizeTrack,
	putKeyframe,
	removeKeyframe,
	repeatKeys,
	sampleNumbers,
	removeKeysAtTimes,
	setEaseAtTimes,
	shiftKeysAt,
	simplifyKeys,
	type KeyEase,
	type Keyframe,
} from "../keyframes";
import {
	groupNames,
	joinGroup,
	keyGroupAt,
	leaveGroup,
	linkValue,
	linkValueAt,
	normalizeKeyLink,
	setGroupCurve,
	setLinkRange,
	toggleGroupKey,
	type KeyLink,
	type Slot,
	type SlotPatches,
} from "../key-groups";
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

/** Placement values grouped to follow one curve, by value. */
export type LaneKeyLinks = Partial<Record<PlacementKey, KeyLink>>;

type LaneKeyed = Pick<MediaLane, "keys" | "keyLinks">;

/** Each placement value's slider range and step, as the panel shows them. */
export const PLACEMENT_RANGES: Record<
	PlacementKey,
	{ label: string; min: number; max: number; step: number }
> = {
	x: { label: "X", min: -0.5, max: 1.5, step: 0.005 },
	y: { label: "Y", min: -0.5, max: 1.5, step: 0.005 },
	scale: { label: "Scale", min: 0.05, max: 3, step: 0.01 },
	scaleX: { label: "Scale X", min: -3, max: 3, step: 0.01 },
	scaleY: { label: "Scale Y", min: -3, max: 3, step: 0.01 },
	rotation: { label: "Rotation", min: -180, max: 180, step: 1 },
	opacity: { label: "Opacity", min: 0, max: 1, step: 0.01 },
};

/** More keys than any hand-built track; a save listing more is damaged. */
const MAX_KEYS = 1000;

function tracks(lane: LaneKeyed): Keyframe<number>[][] {
	return [
		...Object.values(lane.keys ?? {}),
		...Object.values(lane.keyLinks ?? {}).map((l) => l?.keys),
	].filter((k): k is Keyframe<number>[] => !!k);
}

export function isPlacementGrouped(
	lane: LaneKeyed,
	key: PlacementKey,
): boolean {
	return !!lane.keyLinks?.[key];
}

export function hasLaneKeys(lane: LaneKeyed): boolean {
	return tracks(lane).length > 0;
}

export function isPlacementKeyed(lane: LaneKeyed, key: PlacementKey): boolean {
	return (lane.keys?.[key]?.length ?? 0) > 0;
}

/** The lane's placement at timeline `time`. A lane without keys hands back its style. */
export function laneStyleAt(
	lane: Pick<MediaLane, "keys" | "keyLinks" | "style">,
	time: number | null | undefined,
): MediaStyle {
	if (time == null || !hasLaneKeys(lane)) return lane.style;
	const style = { ...lane.style };
	for (const key of PLACEMENT_KEYS) {
		const link = lane.keyLinks?.[key];
		const v = link
			? linkValueAt(link, time, PLACEMENT_RANGES[key])
			: sampleNumbers(lane.keys?.[key], time);
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

function withLink(
	lane: MediaLane,
	key: PlacementKey,
	link: KeyLink | null,
): MediaLane {
	const next: LaneKeyLinks = { ...lane.keyLinks };
	if (link) next[key] = link;
	else delete next[key];
	const { keyLinks: _, ...rest } = lane;
	return Object.keys(next).length > 0 ? { ...rest, keyLinks: next } : rest;
}

/** The lane with `keys` as that value's whole track; emptied, it holds its first key. */
export function setLaneTrack(
	lane: MediaLane,
	key: PlacementKey,
	keys: Keyframe<number>[],
): MediaLane {
	const before = lane.keys?.[key];
	const next = withTrack(lane, key, keys);
	return keys.length === 0 && before?.length
		? { ...next, style: { ...next.style, [key]: before[0].v } }
		: next;
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
		if (isPlacementGrouped(lane, key)) {
			next.style[key] = lane.style[key];
			if (style[key] === shown[key]) continue;
			next = applyLanePatches(
				next,
				keyGroupAt(laneSlots(next), laneSlot(next, key), time, style[key]),
			);
			continue;
		}
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
	if (isPlacementGrouped(lane, key))
		return applyLanePatches(
			lane,
			toggleGroupKey(laneSlots(lane), laneSlot(lane, key), time, clear),
		);
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
	lane: LaneKeyed,
	key: PlacementKey,
	time: number,
): Keyframe<number> | null {
	return keyNear(lane.keys?.[key], time);
}

export function laneKeyTimes(lane: LaneKeyed): number[] {
	return keyTimesOf(tracks(lane));
}

export function laneEaseAt(
	lane: LaneKeyed,
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
		const link = lane.keyLinks?.[key];
		if (!link) continue;
		const mapped = map(link.keys);
		next = withLink(
			next,
			key,
			mapped.length > 0 ? { ...link, keys: mapped } : null,
		);
		// A curve emptied lets the value go, where the curve started.
		if (mapped.length === 0 && link.keys.length > 0)
			next = {
				...next,
				style: {
					...next.style,
					[key]: linkValue(link, link.keys[0].v, PLACEMENT_RANGES[key]),
				},
			};
	}
	return next;
}

export function moveLaneKeys(
	lane: MediaLane,
	times: readonly number[],
	delta: number,
): MediaLane {
	return mapTracks(lane, (keys) => shiftKeysAt(keys, times, delta));
}

/** A track left with nothing keeps the value its first key had. */
function settleEmptied(before: MediaLane, after: MediaLane): MediaLane {
	const style = { ...after.style };
	for (const key of PLACEMENT_KEYS) {
		const keys = before.keys?.[key];
		if (keys?.length && !isPlacementKeyed(after, key)) style[key] = keys[0].v;
	}
	return { ...after, style };
}

export function removeLaneKeysAt(
	lane: MediaLane,
	times: readonly number[],
): MediaLane {
	return settleEmptied(
		lane,
		mapTracks(lane, (keys) => removeKeysAtTimes(keys, times)),
	);
}

export function clearLaneKeys(lane: MediaLane): MediaLane {
	return settleEmptied(
		lane,
		mapTracks(lane, () => []),
	);
}

export function setLaneEaseAt(
	lane: MediaLane,
	times: readonly number[],
	ease: KeyEase | undefined,
): MediaLane {
	return mapTracks(lane, (keys) => setEaseAtTimes(keys, times, ease));
}

/** How far thinned keys may stray from the motion they replace. */
export const PLACEMENT_TOLERANCE: Record<PlacementKey, number> = {
	x: 0.004,
	y: 0.004,
	scale: 0.01,
	scaleX: 0.01,
	scaleY: 0.01,
	rotation: 0.5,
	opacity: 0.01,
};

export function simplifyLaneKeys(lane: MediaLane): MediaLane {
	let next = lane;
	for (const key of PLACEMENT_KEYS) {
		const keys = lane.keys?.[key];
		if (keys)
			next = withTrack(next, key, simplifyKeys(keys, PLACEMENT_TOLERANCE[key]));
		const link = lane.keyLinks?.[key];
		if (link)
			next = withLink(next, key, {
				...link,
				keys: simplifyKeys(link.keys, 0.01),
			});
	}
	return next;
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

/** A placement value as a groupable slot (see key-groups.ts). */
export function laneSlot(lane: MediaLane, key: PlacementKey): Slot {
	const { min, max, step } = PLACEMENT_RANGES[key];
	return {
		id: key,
		keys: lane.keys?.[key],
		link: lane.keyLinks?.[key],
		value: lane.style[key],
		min,
		max,
		step,
	};
}

/** Every placement value that is keyed or grouped. */
export function laneSlots(lane: MediaLane): Slot[] {
	return PLACEMENT_KEYS.filter(
		(k) => isPlacementKeyed(lane, k) || isPlacementGrouped(lane, k),
	).map((k) => laneSlot(lane, k));
}

export function laneGroupNames(lane: MediaLane): string[] {
	return groupNames(laneSlots(lane));
}

export function applyLanePatches(
	lane: MediaLane,
	patches: SlotPatches,
): MediaLane {
	let next = lane;
	for (const [id, patch] of patches) {
		const key = id as PlacementKey;
		if (patch.keys !== undefined) next = withTrack(next, key, patch.keys);
		if (patch.link !== undefined) next = withLink(next, key, patch.link);
		if (patch.value !== undefined)
			next = { ...next, style: { ...next.style, [key]: patch.value } };
	}
	return next;
}

export function groupPlacement(
	lane: MediaLane,
	key: PlacementKey,
	group: string | null,
	time: number,
): MediaLane {
	return applyLanePatches(
		lane,
		joinGroup(laneSlots(lane), laneSlot(lane, key), group, time),
	);
}

export function ungroupPlacement(
	lane: MediaLane,
	key: PlacementKey,
): MediaLane {
	return applyLanePatches(lane, leaveGroup(laneSlot(lane, key)));
}

export function setPlacementGroupRange(
	lane: MediaLane,
	key: PlacementKey,
	range: Partial<Pick<KeyLink, "min" | "max" | "inverted">>,
): MediaLane {
	return applyLanePatches(lane, setLinkRange(laneSlot(lane, key), range));
}

export function setLaneGroupCurve(
	lane: MediaLane,
	group: string,
	keys: Keyframe<number>[],
): MediaLane {
	return applyLanePatches(lane, setGroupCurve(laneSlots(lane), group, keys));
}

export function normalizeLaneKeyLinks(raw: unknown): LaneKeyLinks | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: LaneKeyLinks = {};
	for (const key of PLACEMENT_KEYS) {
		const link = normalizeKeyLink(
			(raw as Record<string, unknown>)[key],
			PLACEMENT_RANGES[key],
		);
		if (link) out[key] = link;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}
