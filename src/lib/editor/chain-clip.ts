/**
 * A clip that carries its own effect chain — the shape the fx lanes and the
 * media lanes share, so the roll, fill, clear and mode rules live here once
 * and both lane kinds call them.
 *
 * "static": `effects` is the concrete, user-editable chain for the whole span.
 * "interval": the chain is re-rolled deterministically every `intervalSec`
 * from `seed`, so preview and export always agree.
 */

import type { AudioResponse } from "../audio/auto-range";
import { applyPreset } from "../effects";
import {
	cloneEffectInstance,
	type EffectInstance,
	type FreqBand,
	type Preset,
} from "../effects";
import {
	clipAt,
	MIN_CLIP_LENGTH,
	sortClips,
	type ClipLane,
	type TimelineClip,
} from "../timeline/clips";
import type { MoshOptions } from "./mosh";
import { putRoll } from "./roll-cache";
import type { MoshSnapshot } from "./mosh-history";
import {
	cleanEffects,
	DEFAULT_INTERVAL_SEC,
	randomSeed,
	rollEffects,
	type ChainMode,
} from "./sequence";

export interface ChainClip extends TimelineClip {
	/** Display label: preset name, "mosh", "clean", … */
	label: string;
	/** Absent on clips saved before interval mode; treated as "static". */
	mode?: ChainMode;
	/** Preset this clip was filled from; an explicit overwrite re-syncs it. */
	presetName?: string;
	/** Set once the user hand-edits a preset-filled clip. */
	modified?: boolean;
	effects: EffectInstance[];
	/** "interval" mode: seconds between re-rolls. */
	intervalSec?: number;
	/** "interval" mode: the spacing in beats, when picked that way, so a later
	 * BPM correction can re-derive the seconds. */
	intervalBeats?: number;
	/** "interval" mode: base seed for per-tick rolls. */
	seed?: number;
}

/** 0-based re-roll tick index inside an interval clip. */
export function chainClipTick(clip: ChainClip, time: number): number {
	const interval = clip.intervalSec ?? DEFAULT_INTERVAL_SEC;
	return Math.max(0, Math.floor((time - clip.start) / interval));
}

/**
 * Switch a clip to a re-roll mode. Going to "interval" mints a seed if there
 * isn't one, so the rolls are reproducible from the moment it's turned on;
 * going back to "static" keeps the last concrete chain rather than blanking it.
 */
export function withChainMode<C extends ChainClip>(
	clip: C,
	mode: ChainMode,
	intervalSec?: number,
	intervalBeats?: number | null,
): C {
	if (mode === "static") {
		return { ...clip, mode: "static", label: clip.presetName ?? clip.label };
	}
	return {
		...clip,
		mode: "interval",
		label: "auto",
		seed: clip.seed ?? randomSeed(),
		intervalSec: intervalSec ?? clip.intervalSec ?? DEFAULT_INTERVAL_SEC,
		// null explicitly drops the beat link, so a later BPM change leaves a
		// hand-picked duration alone; undefined leaves whatever was there.
		intervalBeats:
			intervalBeats === null
				? undefined
				: (intervalBeats ?? clip.intervalBeats),
	};
}

/** Re-roll: a static clip gets a fresh concrete chain, an interval clip a new
 * base seed, which re-rolls every tick in the span at once. */
export function rolledChainClip<C extends ChainClip>(
	clip: C,
	options: MoshOptions,
): C {
	if (clip.mode === "interval") return { ...clip, seed: randomSeed() };
	return {
		...clip,
		effects: rollEffects(randomSeed(), options),
		label: "mosh",
		presetName: undefined,
		modified: false,
	};
}

/** Reset to an all-disabled static chain. */
export function clearedChainClip<C extends ChainClip>(clip: C): C {
	return {
		...clip,
		mode: "static",
		effects: cleanEffects(),
		label: "clean",
		presetName: undefined,
		modified: false,
	};
}

/** Fill from a preset: a concrete chain under the preset's name. */
export function filledChainClip<C extends ChainClip>(
	clip: C,
	preset: Preset,
): C {
	return {
		...clip,
		mode: "static",
		label: preset.name,
		presetName: preset.name,
		modified: false,
		effects: applyPreset(preset),
	};
}

/**
 * A preset was explicitly overwritten — refresh a static clip filled from it,
 * so it tracks the newest version. Hand-edited ("modified") clips keep theirs.
 */
export function syncedChainClip<C extends ChainClip>(
	clip: C,
	preset: Preset,
): C {
	return (clip.mode ?? "static") === "static" &&
		clip.presetName === preset.name &&
		!clip.modified
		? { ...clip, label: preset.name, effects: applyPreset(preset) }
		: clip;
}

/** The mosh-relevant slice of a clip, for the ←/→ history. */
export function chainClipMoshSnapshot(clip: ChainClip): MoshSnapshot {
	return {
		effects: clip.effects,
		seed: clip.seed,
		label: clip.label,
		presetName: clip.presetName,
		modified: clip.modified,
	};
}

/**
 * Put a clip back to a remembered mosh. Timing is deliberately excluded:
 * walking the mosh history must change what a clip renders, never where it
 * sits.
 */
export function withChainMosh<C extends ChainClip>(
	clip: C,
	snap: MoshSnapshot,
): C {
	return {
		...clip,
		effects: snap.effects.map(cloneEffectInstance),
		seed: snap.seed,
		label: snap.label,
		presetName: snap.presetName,
		modified: snap.modified,
	};
}

export function cloneChainEffects(effects: EffectInstance[]): EffectInstance[] {
	return effects.map(cloneEffectInstance);
}

/**
 * Cut the clip covering `at` in two. The lane comes back unchanged when `at`
 * isn't inside a clip, or when either half would be shorter than
 * MIN_CLIP_LENGTH. Each half gets an id from `newId` and its own deep copy of
 * the chain, so editing one no longer touches the other; `tail` lets a lane
 * kind adjust the right half, given the clip it came from (a media clip
 * advances its in-point by the cut).
 */
export function splitChainClipAt<
	L extends ClipLane<ChainClip>,
	C extends ChainClip = L["clips"][number],
>(
	lane: L,
	at: number,
	newId: () => string,
	tail: (half: C, original: C) => C = (half) => half,
): L {
	const clip = clipAt(lane, at) as C | null;
	if (!clip) return lane;
	if (at - clip.start < MIN_CLIP_LENGTH || clip.end - at < MIN_CLIP_LENGTH) {
		return lane;
	}
	const head: C = {
		...clip,
		id: newId(),
		end: at,
		effects: cloneChainEffects(clip.effects),
	};
	const rest: C = {
		...clip,
		id: newId(),
		start: at,
		effects: cloneChainEffects(clip.effects),
	};
	return {
		...lane,
		clips: sortClips([
			...lane.clips.filter((c) => c.id !== clip.id),
			head,
			tail(rest, clip),
		]),
	};
}

/**
 * The chain a clip contributes at `time`. Static clips hand back their own
 * array (or a cached deep clone when `clone` is set, so an export can write
 * per-frame audio-link values without them landing in the clip being edited).
 * Interval clips roll per tick through the shared bounded cache, keyed by
 * seed and the mosh options — a settings change must never serve rolls made
 * under different parameters, or the preview and export would disagree.
 */
export function chainClipEffectsAt(
	clip: ChainClip,
	time: number,
	cache: Map<string, EffectInstance[]>,
	clone: boolean,
	getMoshOptions: () => MoshOptions,
): EffectInstance[] {
	if (clip.mode !== "interval") {
		if (!clone) return clip.effects;
		// Cached per clip, not per frame: a static clip's chain is the same objects
		// for its whole span, and re-cloning 39 effects per frame is not free.
		let cloned = cache.get(clip.id);
		if (!cloned) {
			cloned = cloneChainEffects(clip.effects);
			cache.set(clip.id, cloned);
		}
		return cloned;
	}

	const options = getMoshOptions();
	const tick = chainClipTick(clip, time);
	const seed = (clip.seed ?? 0) + tick * 7919;
	const key = `${clip.id}:${seed}:${options.moshMin}:${options.moshMax}:${options.randomizeOrder}:${options.moshAudioLink}:${options.moshAudioLinkStrength}:${options.moshLinkBand}:${options.hasAudio}`;
	let effects = cache.get(key);
	if (!effects) {
		effects = rollEffects(seed, options);
		putRoll(cache, key, effects);
	}
	return effects;
}

/** Normalize the chain fields a saved clip may predate or have dropped. */
export function normalizeChainFields(
	raw: Partial<ChainClip>,
	effects: EffectInstance[],
): Omit<ChainClip, "id" | "start" | "end"> {
	const out: Omit<ChainClip, "id" | "start" | "end"> = {
		label: raw.label ?? "clean",
		effects,
	};
	if (raw.mode === "interval") out.mode = "interval";
	if (raw.presetName) out.presetName = raw.presetName;
	if (raw.modified) out.modified = true;
	if (typeof raw.intervalSec === "number") out.intervalSec = raw.intervalSec;
	if (typeof raw.intervalBeats === "number")
		out.intervalBeats = raw.intervalBeats;
	if (typeof raw.seed === "number") out.seed = raw.seed;
	return out;
}

/**
 * How one lane rolls its moshes and how its links follow the music.
 *
 * A lane is its own instrument: a slow-breathing wash on one lane and a hard
 * per-hit stutter on another want opposite settings, and one global set could
 * only ever serve one of them. Shared by the fx and media lanes.
 */
export interface LaneSettings {
	moshMin: number;
	moshMax: number;
	randomizeOrder: boolean;
	moshAudioLink: boolean;
	moshAudioLinkStrength: number;
	moshLinkBand: FreqBand;
	/** How this lane's linked params follow the band they listen to. */
	audioResponse: AudioResponse;
}

/** A lane that may carry its own settings. Absent = it follows the editor's. */
export interface SettingsOwner {
	settings?: LaneSettings;
}

/** The options a lane rolls under: its own settings, or the editor's. */
export function laneMoshOptions(
	lane: SettingsOwner,
	fallback: MoshOptions,
): MoshOptions {
	const s = lane.settings;
	if (!s) return fallback;
	return {
		moshMin: s.moshMin,
		moshMax: s.moshMax,
		randomizeOrder: s.randomizeOrder,
		moshAudioLink: s.moshAudioLink,
		moshAudioLinkStrength: s.moshAudioLinkStrength,
		moshLinkBand: s.moshLinkBand,
		// Not the lane's to decide: whether a track is loaded at all, and whether
		// the roll is restricted to what is already switched on, are the session's.
		hasAudio: fallback.hasAudio,
		onlyMoshEnabled: fallback.onlyMoshEnabled,
	};
}

/** How a lane's links follow the music: its own response, or the editor's. */
export function laneAudioResponse(
	lane: SettingsOwner,
	fallback: AudioResponse,
): AudioResponse {
	return lane.settings?.audioResponse ?? fallback;
}

/** A stored settings block is kept only if it is complete — a half-written one
 * would leave the lane rolling under a mix of its own values and the
 * editor's, which is neither of the two things the user set up. */
export function normalizeLaneSettings(raw: unknown): LaneSettings | undefined {
	const s = raw as Partial<LaneSettings> | undefined;
	if (!s || typeof s !== "object") return undefined;
	const r = s.audioResponse;
	if (
		typeof s.moshMin !== "number" ||
		typeof s.moshMax !== "number" ||
		typeof s.moshAudioLinkStrength !== "number" ||
		!r ||
		typeof r.smoothing !== "number" ||
		typeof r.punch !== "number"
	) {
		return undefined;
	}
	return {
		moshMin: s.moshMin,
		moshMax: s.moshMax,
		randomizeOrder: s.randomizeOrder !== false,
		moshAudioLink: s.moshAudioLink !== false,
		moshAudioLinkStrength: s.moshAudioLinkStrength,
		moshLinkBand: s.moshLinkBand ?? "full",
		audioResponse: { smoothing: r.smoothing, punch: r.punch },
	};
}
