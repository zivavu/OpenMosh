/** A clip that carries its own effect chain, shared by the fx and media lanes. */

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
	/** "interval" mode: spacing in beats, so a BPM correction re-derives the seconds. */
	intervalBeats?: number;
	/** "interval" mode: base seed for per-tick rolls. */
	seed?: number;
}

/** 0-based re-roll tick index inside an interval clip. */
export function chainClipTick(clip: ChainClip, time: number): number {
	const interval = clip.intervalSec ?? DEFAULT_INTERVAL_SEC;
	return Math.max(0, Math.floor((time - clip.start) / interval));
}

/** Switch a clip to a re-roll mode; "static" keeps the last concrete chain. */
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
		// null drops the beat link; undefined leaves what was there.
		intervalBeats:
			intervalBeats === null
				? undefined
				: (intervalBeats ?? clip.intervalBeats),
	};
}

/** Re-roll: a static clip gets a fresh chain, an interval clip a new base seed. */
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

/** A preset was overwritten: refresh a static clip filled from it. */
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

/** Put a clip back to a remembered mosh; timing is excluded. */
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

/** Cut the clip covering `at` in two; no-op when a half would be too short. */
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

/** The chain a clip contributes at `time`; static clips hand back their own array. */
export function chainClipEffectsAt(
	clip: ChainClip,
	time: number,
	cache: Map<string, EffectInstance[]>,
	clone: boolean,
	getMoshOptions: () => MoshOptions,
): EffectInstance[] {
	if (clip.mode !== "interval") {
		if (!clone) return clip.effects;
		// Cached per clip, not per frame: a static clip's chain is the same for its whole span.
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

/** How one lane rolls its moshes and how its links follow the music. */
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
		// Not the lane's to decide: hasAudio and onlyMoshEnabled are the session's.
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

/** A stored settings block is kept only if complete. */
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
