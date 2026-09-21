/**
 * Stacked effect lanes for sequence mode.
 *
 * The media layers say what a span of time shows. An fx lane says only "also
 * run these effects over the frame here" — it takes no media, and where it
 * holds nothing, it costs nothing. That makes it a lane of free-floating clips
 * (see timeline/clips.ts).
 *
 * Composition is plain concatenation. GlRenderer runs an EffectInstance[]
 * sequentially through its ping-pong FBOs and keys every piece of per-effect
 * state (feedback buffers, phase, tracking) by instanceId, so appending one
 * lane's chain to another's is exactly "and then run these too" — two lanes
 * can even hold the same effect without colliding.
 */

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
	cloneChainEffects,
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

/**
 * One span of extra effects on an fx lane: a chain clip (see chain-clip.ts)
 * plus a fade of its own.
 */
export interface FxClip extends ChainClip {
	/**
	 * Fade the lane's contribution in over this many seconds from the clip's
	 * start, and out over the same before its end.
	 *
	 * Not a scene transition: a stacked lane has no "other side" — before the
	 * clip the lane contributes nothing at all. What a clip boundary needs is
	 * the chain arriving rather than snapping on, so this scales the parameters
	 * of the lane's own effects toward their disabled state instead of
	 * compositing anything.
	 */
	fadeSec?: number;
}

/** Default ramp for a clip that asks for one, in seconds. */
export const DEFAULT_FX_FADE = 0.25;

/**
 * How strongly `clip` applies at `time`: 1 across the body, ramping from 0 at
 * each edge when the clip has a fade. Returns 1 for clips without one, which is
 * every clip until the user asks for a ramp.
 */
export function fxClipWeight(clip: FxClip, time: number): number {
	return clipFadeWeight(clip, clip.fadeSec, clip.fadeSec, time);
}

/** 0-based re-roll tick index inside an interval clip. */
export const fxClipTick: (clip: FxClip, time: number) => number = chainClipTick;

/** See LaneSettings — the fx lanes were the first to carry their own. */
export type FxLaneSettings = LaneSettings;

/**
 * A stacked effect layer. Clips within a lane never overlap, so a lane
 * contributes at most one chain at a time and drag/resize stay unambiguous.
 */
export interface FxLane {
	id: string;
	name: string;
	/** Off = the lane contributes nothing, without losing its clips. */
	enabled: boolean;
	/**
	 * Place in the stack it shares with the text and media layers. A lane above
	 * a layer applies its chain to that layer too; below it, the layer
	 * composites over whatever the lane produced.
	 */
	z: number;
	clips: FxClip[];
	/** Absent on lanes saved before per-lane settings, and on lanes the user has
	 * never opened: those follow the editor's settings, as they always did. */
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

/** Most stacked lanes at once. A sanity cap, not a frame budget: the renderer
 * keeps up with far more passes than anyone stacks on purpose. */
export const MAX_FX_LANES = 20;

/**
 * Add a lane, named after its position. At the cap, returns the input by
 * identity so callers can skip a history entry for a no-op.
 *
 * The lane starts with one clean clip across the whole timeline rather than
 * bare: an empty lane renders nothing and offers nothing to select, so the
 * first thing to do with one was always to draw a clip over it. A full-width
 * clean clip is that same starting point, already there to mosh or fill from a
 * preset — and still contributes nothing until its effects are switched on.
 * Falls back to a bare lane when there is no timeline yet (duration 0).
 */
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

/**
 * The clips contributing at `time`, in lane order — which is chain order, so
 * reordering lanes reorders the passes.
 *
 * `forceClipId` is the clip being edited in the panel: its lane contributes it
 * whatever the playhead is over, and contributes nothing else — so a tweak is
 * never invisible because the playhead sits past the clip, and the chain can't
 * carry the same instanceId twice (which would leave two passes sharing one
 * feedback buffer). Preview only; the export passes no override.
 */
export function activeFxClips(
	lanes: FxLane[] | null | undefined,
	time: number,
	forceClipId?: string | null,
): FxClip[] {
	return activeFxParts(lanes, time, forceClipId).map((p) => p.clip);
}

/** The same walk, keeping the lane each clip came from — the settings it rolls
 * and follows the music under live there. */
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
const NO_CLIPS: FxClip[] = [];
const NO_PARTS: { lane: FxLane; clip: FxClip }[] = [];
const NO_LAYERS: FxLayer[] = [];

/**
 * One lane's contribution for a frame. Structurally the renderer's
 * PostChainLayer: the chain the lane adds, and how strongly it applies.
 */
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
	/**
	 * Serve static clips as cached deep clones, so the export can write each
	 * frame's audio-link values into the chain it renders without those values
	 * landing in the clips the user is still editing.
	 */
	clone?: boolean;
}

/**
 * Time → stacked lanes resolver. Preview and export both build one of these,
 * so a frame that was scrubbed past is the frame that gets written out:
 * interval rolls are keyed by (clip, seed, tick, mosh options), which makes a
 * fresh source built from the same inputs reproduce the preview exactly.
 *
 * Returns a shared empty array when nothing is active, so the common "no fx
 * lanes here" frame doesn't mint an array the render loop has to re-check.
 *
 * A frame whose layers came out identical to the last one gets that same array
 * back rather than an equal copy. The preview calls this from a derived that
 * re-runs on every tick of an interpolated clock, and most of those ticks land
 * inside the same clips at the same weights — handing back a fresh array there
 * would invalidate the whole chain downstream (and the canvas props with it)
 * for a frame that renders exactly the same thing.
 */
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
			// A clip pinned in for editing shows at full strength: the fade is about
			// how it enters during playback, and ramping it here would leave the
			// panel adjusting a chain that is only partly on screen.
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

/** Every stacked effect for a frame, in lane order — for the audio-link tick
 * and the animation check, which care about the instances, not the weights. */
export function flattenFxLayers(layers: FxLayer[]): EffectInstance[] {
	if (layers.length === 0) return EMPTY;
	let out: EffectInstance[] | null = null;
	for (const layer of layers) (out ??= []).push(...layer.effects);
	return out ?? EMPTY;
}

/** Every effect instance held anywhere in the lanes (for feedback-buffer GC). */
export function allFxEffectIds(lanes: FxLane[] | null | undefined): string[] {
	const ids: string[] = [];
	for (const lane of lanes ?? []) {
		for (const clip of lane.clips) {
			for (const eff of clip.effects) ids.push(eff.instanceId);
		}
	}
	return ids;
}

/** Apply an edit to every clip in `clipIds`, across lanes. */
export function updateFxClips(
	lanes: FxLane[],
	clipIds: Set<string>,
	fn: (clip: FxClip) => FxClip,
): FxLane[] {
	return updateClipsIn(lanes, clipIds, fn);
}

/**
 * Switch clips to a re-roll mode. Going to "interval" mints a seed if there
 * isn't one, so the rolls are reproducible from the moment it's turned on;
 * going back to "static" keeps the last concrete chain rather than blanking it.
 */
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

/**
 * Re-roll clips. Static clips get a fresh concrete chain; interval clips get a
 * new base seed, which re-rolls every tick in the span at once.
 */
export function rollFxClips(
	lanes: FxLane[],
	clipIds: Set<string>,
	options: MoshOptions,
): FxLane[] {
	return lanes.map((lane) => {
		if (!lane.clips.some((c) => clipIds.has(c.id))) return lane;
		// Each lane rolls under its own settings, so one Mosh over a selection
		// spanning lanes gives each lane the mosh it is set up for.
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

/**
 * Cut the clip covering `at` into two (Ctrl+Click). Both halves keep the chain — deep-copied, so editing one no longer
 * touches the other — along with the mode, interval spacing and seed.
 *
 * Returns the lane unchanged when `at` isn't inside a clip, or when either half
 * would come out shorter than MIN_CLIP_LENGTH.
 */
export function splitFxClipAt(lane: FxLane, at: number): FxLane {
	return splitChainClipAt(lane, at, generateId);
}

/** Put a clip back to a remembered mosh — see withChainMosh. */
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

/**
 * Deep copy for the export path, which applies per-frame audio-link values
 * into the chain it renders and must not write them back into the clips the
 * user is editing.
 */
export const cloneFxEffects: (effects: EffectInstance[]) => EffectInstance[] =
	cloneChainEffects;

/** Fill in anything a saved lane list predates or dropped. */
export function normalizeFxLanes(raw: unknown): FxLane[] {
	if (!Array.isArray(raw)) return [];
	const lanes = raw;
	return raw.map((lane: Partial<FxLane>, i) => ({
		id: lane.id ?? generateId(),
		name: lane.name ?? `FX ${i + 1}`,
		enabled: lane.enabled !== false,
		// Lanes saved before the shared stack existed sit under every layer, which
		// is where they rendered: layers composited over the finished lane output.
		z: typeof lane.z === "number" ? lane.z : i - lanes.length,
		settings: normalizeLaneSettings(lane.settings),
		clips: (Array.isArray(lane.clips) ? lane.clips : [])
			// A clip with no chain would be an invisible span that still takes up
			// room on the lane; drop it rather than resurrect it empty.
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

/**
 * Re-derive `intervalSec` for every clip whose interval was set in beats, so
 * correcting the BPM retimes them. Returns the input by identity when nothing
 * moves, so callers can skip a redundant commit.
 */
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
