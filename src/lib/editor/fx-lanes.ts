/** Stacked effect lanes for sequence mode; an fx lane takes no media, just effects. */

import {
	generateId,
	restoreEffects,
	type EffectInstance,
	type Preset,
} from "../effects";
import {
	clipAt,
	clipFadeWeight,
	fitClipsToDuration,
	MIN_CLIP_LENGTH,
	updateClipsIn,
} from "../timeline/clips";
import {
	chainClipEffectsAt,
	chainClipMoshSnapshot,
	chainClipTick,
	clearedChainClip,
	splitChainClipAt,
	rolledChainClip,
	syncedChainClip,
	withChainMode,
	withChainMosh,
	type ChainClip,
	laneAudioResponse,
	laneMoshOptions,
	type LaneSettings,
	normalizeLaneSettings,
} from "./chain-clip";
export { laneAudioResponse, laneMoshOptions };
import type { MoshOptions } from "./mosh";
import type { MoshSnapshot } from "./mosh-history";
import { beatsToSeconds, cleanEffects, type ChainMode } from "./sequence";

/** One span of extra effects on an fx lane: a chain clip (see chain-clip.ts) plus a fade. */
export interface FxClip extends ChainClip {
	/** Fade the lane's contribution in and out over this many seconds at each edge. */
	fadeSec?: number;
}

/** How strongly `clip` applies at `time`: 1 across the body, 0 at a faded edge. */
export function fxClipWeight(clip: FxClip, time: number): number {
	return clipFadeWeight(clip, clip.fadeSec, clip.fadeSec, time);
}

/** 0-based re-roll tick index inside an interval clip. */
export const fxClipTick: (clip: FxClip, time: number) => number = chainClipTick;

/** See LaneSettings; the fx lanes were the first to carry their own. */
export type FxLaneSettings = LaneSettings;

/** A stacked effect layer; clips within a lane never overlap. */
export interface FxLane {
	id: string;
	name: string;
	/** Off = the lane contributes nothing, without losing its clips. */
	enabled: boolean;
	/** Place in the shared stack; a lane above a layer applies its chain to it too. */
	z: number;
	clips: FxClip[];
	/** Absent on lanes saved before per-lane settings; those follow the editor's. */
	settings?: FxLaneSettings;
}

export function createFxClip(start: number, end: number): FxClip {
	return {
		id: generateId(),
		start,
		end,
		mode: "static",
		label: "clean",
		effects: cleanEffects(),
	};
}

export function createFxLane(
	name: string,
	settings?: FxLaneSettings,
	z = 0,
): FxLane {
	return { id: generateId(), name, enabled: true, z, clips: [], settings };
}

/** Most stacked lanes at once. A sanity cap, not a frame budget. */
export const MAX_FX_LANES = 20;

/** Add a lane, named after its position; at the cap returns the input by identity. */
export function appendFxLane(
	lanes: FxLane[],
	settings?: FxLaneSettings,
	duration = 0,
	z = 0,
): FxLane[] {
	if (lanes.length >= MAX_FX_LANES) return lanes;
	const lane = createFxLane(`FX ${lanes.length + 1}`, settings, z);
	if (duration >= MIN_CLIP_LENGTH) lane.clips = [createFxClip(0, duration)];
	return [...lanes, lane];
}

/** The clips contributing at `time`, in lane order, which is chain order. */
export function activeFxClips(
	lanes: FxLane[] | null | undefined,
	time: number,
	forceClipId?: string | null,
): FxClip[] {
	return activeFxParts(lanes, time, forceClipId).map((p) => p.clip);
}

/** The same walk, keeping the lane each clip came from; its settings live there. */
function activeFxParts(
	lanes: FxLane[] | null | undefined,
	time: number,
	forceClipId?: string | null,
): { lane: FxLane; clip: FxClip }[] {
	if (!lanes || lanes.length === 0) return NO_PARTS;
	let out: { lane: FxLane; clip: FxClip }[] | null = null;
	for (const lane of lanes) {
		if (!lane.enabled) continue;
		const forced = forceClipId
			? lane.clips.find((c) => c.id === forceClipId)
			: undefined;
		const clip = forced ?? clipAt(lane, time);
		if (!clip) continue;
		(out ??= []).push({ lane, clip });
	}
	return out ?? NO_PARTS;
}

const EMPTY: EffectInstance[] = [];
const NO_PARTS: { lane: FxLane; clip: FxClip }[] = [];
const NO_LAYERS: FxLayer[] = [];

/** One lane's contribution for a frame; structurally the renderer's PostChainLayer. */
export interface FxLayer {
	effects: EffectInstance[];
	/** 0 = absent, 1 = fully applied. Below 1 only while a clip's fade ramps. */
	weight: number;
	/** Where this lane sits in the stack it shares with the layers. */
	z: number;
	/** Whose settings this chain rolled under, and whose audio response its
	 * links follow. */
	laneId: string;
}

export interface FxEffectSourceOptions {
	/** Serve static clips as cached deep clones, so the export can write into the chain safely. */
	clone?: boolean;
}

/** Time to stacked lanes resolver, shared by preview and export so both agree on a frame. */
export function createFxLayerSource(
	getLanes: () => FxLane[] | null | undefined,
	getMoshOptions: () => MoshOptions,
	{ clone = false }: FxEffectSourceOptions = {},
): (time: number, forceClipId?: string | null) => FxLayer[] {
	const cache = new Map<string, EffectInstance[]>();
	let last: FxLayer[] = NO_LAYERS;
	return (time: number, forceClipId?: string | null) => {
		const parts = activeFxParts(getLanes(), time, forceClipId);
		if (parts.length === 0) {
			last = NO_LAYERS;
			return NO_LAYERS;
		}
		const layers = parts.map(({ lane, clip }) => ({
			laneId: lane.id,
			z: lane.z,
			effects: chainClipEffectsAt(clip, time, cache, clone, () =>
				laneMoshOptions(lane, getMoshOptions()),
			),
			// A clip pinned in for editing shows at full strength, not its fade.
			weight: clip.id === forceClipId ? 1 : fxClipWeight(clip, time),
		}));
		if (sameLayers(last, layers)) return last;
		last = layers;
		return layers;
	};
}

/** Layer-for-layer identical: same chains, by identity, at the same weights. */
function sameLayers(a: FxLayer[], b: FxLayer[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (
			a[i].effects !== b[i].effects ||
			a[i].weight !== b[i].weight ||
			a[i].z !== b[i].z
		) {
			return false;
		}
	}
	return true;
}

/** Every stacked effect for a frame, in lane order. */
export function flattenFxLayers(layers: FxLayer[]): EffectInstance[] {
	if (layers.length === 0) return EMPTY;
	let out: EffectInstance[] | null = null;
	for (const layer of layers) (out ??= []).push(...layer.effects);
	return out ?? EMPTY;
}

/** Apply an edit to every clip in `clipIds`, across lanes. */
function updateFxClips(
	lanes: FxLane[],
	clipIds: Set<string>,
	fn: (clip: FxClip) => FxClip,
): FxLane[] {
	return updateClipsIn(lanes, clipIds, fn);
}

/** Switch clips to a re-roll mode; "static" keeps the last concrete chain. */
export function setFxClipsMode(
	lanes: FxLane[],
	clipIds: Set<string>,
	mode: ChainMode,
	intervalSec?: number,
	intervalBeats?: number | null,
): FxLane[] {
	return updateFxClips(lanes, clipIds, (clip) =>
		withChainMode(clip, mode, intervalSec, intervalBeats),
	);
}

/** Re-roll clips: static ones get a fresh chain, interval ones a new base seed. */
export function rollFxClips(
	lanes: FxLane[],
	clipIds: Set<string>,
	options: MoshOptions,
): FxLane[] {
	return lanes.map((lane) => {
		if (!lane.clips.some((c) => clipIds.has(c.id))) return lane;
		// Each lane rolls under its own settings, so one Mosh over a cross-lane
		// selection gives each lane its own mosh.
		const laneOptions = laneMoshOptions(lane, options);
		return {
			...lane,
			clips: lane.clips.map((clip) =>
				clipIds.has(clip.id) ? rolledChainClip(clip, laneOptions) : clip,
			),
		};
	});
}

/** A preset was overwritten: refresh every unmodified clip filled from it. */
export function syncFxClipsToPreset(lanes: FxLane[], preset: Preset): FxLane[] {
	const ids = new Set(
		lanes.flatMap((l) =>
			l.clips.filter((c) => c.presetName === preset.name).map((c) => c.id),
		),
	);
	if (ids.size === 0) return lanes;
	return updateFxClips(lanes, ids, (clip) => syncedChainClip(clip, preset));
}

/** Reset clips to an all-disabled chain. */
export function clearFxClips(lanes: FxLane[], clipIds: Set<string>): FxLane[] {
	return updateFxClips(lanes, clipIds, clearedChainClip);
}

/** Cut the clip covering `at` into two (Ctrl+Click); no-op when a half would be too short. */
export function splitFxClipAt(lane: FxLane, at: number): FxLane {
	return splitChainClipAt(lane, at, generateId);
}

/** Put a clip back to a remembered mosh; see withChainMosh. */
export function restoreFxClipMosh(
	lanes: FxLane[],
	clipId: string,
	snap: MoshSnapshot,
): FxLane[] {
	return updateFxClips(lanes, new Set([clipId]), (clip) =>
		withChainMosh(clip, snap),
	);
}

/** The mosh-relevant slice of a clip, for the ←/→ history. */
export const fxClipMoshSnapshot: (clip: FxClip) => MoshSnapshot =
	chainClipMoshSnapshot;

/** The lane holding `clipId`, and the clip itself. */
export function findFxClip(
	lanes: FxLane[],
	clipId: string | null | undefined,
): { lane: FxLane; clip: FxClip } | null {
	if (!clipId) return null;
	for (const lane of lanes) {
		const clip = lane.clips.find((c) => c.id === clipId);
		if (clip) return { lane, clip };
	}
	return null;
}

/** Fill in anything a saved lane list predates or dropped. */
export function normalizeFxLanes(raw: unknown): FxLane[] {
	if (!Array.isArray(raw)) return [];
	const lanes = raw;
	return raw.map((lane: Partial<FxLane>, i) => ({
		id: lane.id ?? generateId(),
		name: lane.name ?? `FX ${i + 1}`,
		enabled: lane.enabled !== false,
		// Lanes saved before the shared stack sit under every layer, where they
		// rendered.
		z: typeof lane.z === "number" ? lane.z : i - lanes.length,
		settings: normalizeLaneSettings(lane.settings),
		clips: (Array.isArray(lane.clips) ? lane.clips : [])
			// A clip with no chain would be an invisible span that still takes up room.
			.filter((c: Partial<FxClip>) => Array.isArray(c.effects))
			.map((clip: FxClip) => ({
				id: clip.id ?? generateId(),
				start: clip.start ?? 0,
				end: clip.end ?? 0,
				label: clip.label ?? "clean",
				mode: clip.mode === "interval" ? "interval" : ("static" as ChainMode),
				presetName: clip.presetName,
				modified: clip.modified,
				effects: restoreEffects(clip.effects),
				intervalSec: clip.intervalSec,
				intervalBeats: clip.intervalBeats,
				seed: clip.seed,
				fadeSec: clip.fadeSec,
			})),
	}));
}

/** Re-derive `intervalSec` for beat-set intervals, so a BPM fix retimes them. */
export function applyBpmToFxLanes(lanes: FxLane[], bpm: number): FxLane[] {
	if (bpm <= 0) return lanes;
	let changed = false;
	const out = lanes.map((lane) => {
		let laneChanged = false;
		const clips = lane.clips.map((c) => {
			if (!c.intervalBeats) return c;
			const sec = beatsToSeconds(c.intervalBeats, bpm);
			if (Math.abs((c.intervalSec ?? 0) - sec) < 0.0005) return c;
			laneChanged = true;
			return { ...c, intervalSec: sec };
		});
		if (!laneChanged) return lane;
		changed = true;
		return { ...lane, clips };
	});
	return changed ? out : lanes;
}

/** See fitMediaTimeline: the same re-fit, for the stacked fx lanes. */
export function fitFxLanes(lanes: FxLane[], duration: number): FxLane[] {
	if (duration <= 0 || lanes.length === 0) return lanes;
	const next = lanes.map((lane) => fitClipsToDuration(lane, duration));
	return next.some((l, i) => l !== lanes[i]) ? next : lanes;
}
