/**
 * A clip that carries its own effect chain — the shape the fx lanes and the
 * media lanes share. Segments carry the same fields under different timing
 * (a gapless partition rather than free clips), so the roll, fill, clear and
 * mode rules live here once and the three lane kinds call them.
 *
 * "static": `effects` is the concrete, user-editable chain for the whole span.
 * "interval": the chain is re-rolled deterministically every `intervalSec`
 * from `seed`, so preview and export always agree.
 */

import { applyPreset } from "../effects";
import {
	cloneEffectInstance,
	type EffectInstance,
	type Preset,
} from "../effects";
import type { TimelineClip } from "../timeline/clips";
import type { MoshOptions } from "./mosh";
import { putRoll } from "./roll-cache";
import type { SegmentMoshSnapshot } from "./segment-mosh-history";
import {
	cleanEffects,
	DEFAULT_INTERVAL_SEC,
	randomSeed,
	rollEffects,
	type SequenceSegmentMode,
} from "./sequence";

export interface ChainClip extends TimelineClip {
	/** Display label: preset name, "mosh", "clean", … */
	label: string;
	/** Absent on clips saved before interval mode; treated as "static". */
	mode?: SequenceSegmentMode;
	/** Preset this clip was filled from, for the same re-sync rule as segments. */
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
	mode: SequenceSegmentMode,
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
export function chainClipMoshSnapshot(clip: ChainClip): SegmentMoshSnapshot {
	return {
		effects: clip.effects,
		seed: clip.seed,
		label: clip.label,
		presetName: clip.presetName,
		modified: clip.modified,
	};
}

/**
 * Put a clip back to a remembered mosh. Timing is deliberately excluded, the
 * same way restoreSegmentMosh leaves a segment's span alone: walking the mosh
 * history must change what a clip renders, never where it sits.
 */
export function withChainMosh<C extends ChainClip>(
	clip: C,
	snap: SegmentMoshSnapshot,
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
