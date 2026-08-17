/**
 * Stacked effect lanes for sequence mode.
 *
 * The source lane (SequenceTimeline) says which media a span of time draws
 * from and what chain runs over it. An fx lane says only "also run these
 * effects here" — it takes no media, and where it holds nothing, it costs
 * nothing. That makes it a lane of free-floating clips (see timeline/clips.ts)
 * rather than a second gapless partition.
 *
 * Composition is plain concatenation. GlRenderer runs an EffectInstance[]
 * sequentially through its ping-pong FBOs and keys every piece of per-effect
 * state (feedback buffers, phase, tracking) by instanceId, so appending a
 * lane's chain to the source lane's is exactly "and then run these too" — two
 * lanes can even hold the same effect without colliding.
 */

import { cloneEffectInstance, generateId, type EffectInstance } from "../effects";
import { clipAt, type TimelineClip } from "../timeline/clips";
import type { MoshOptions } from "./mosh";
import {
  beatsToSeconds,
  cleanEffects,
  DEFAULT_INTERVAL_SEC,
  randomSeed,
  rollEffects,
  type SequenceSegmentMode,
} from "./sequence";

/**
 * One span of extra effects on an fx lane.
 *
 * "static": `effects` is the concrete, user-editable chain for the whole span.
 * "interval": the chain is re-rolled deterministically every `intervalSec` from
 * `seed`, exactly as an interval segment is — so preview and export agree.
 */
export interface FxClip extends TimelineClip {
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
export function fxClipTick(clip: FxClip, time: number): number {
  const interval = clip.intervalSec ?? DEFAULT_INTERVAL_SEC;
  return Math.max(0, Math.floor((time - clip.start) / interval));
}

/**
 * A stacked effect layer. Clips within a lane never overlap, so a lane
 * contributes at most one chain at a time and drag/resize stay unambiguous.
 */
export interface FxLane {
  id: string;
  name: string;
  /** Off = the lane contributes nothing, without losing its clips. */
  enabled: boolean;
  clips: FxClip[];
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

export function createFxLane(name: string): FxLane {
  return { id: generateId(), name, enabled: true, clips: [] };
}

/** Add an empty lane, named after its position. */
export function appendFxLane(lanes: FxLane[]): FxLane[] {
  return [...lanes, createFxLane(`FX ${lanes.length + 1}`)];
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
  if (!lanes || lanes.length === 0) return NO_CLIPS;
  let out: FxClip[] | null = null;
  for (const lane of lanes) {
    if (!lane.enabled) continue;
    const forced = forceClipId
      ? lane.clips.find((c) => c.id === forceClipId)
      : undefined;
    const clip = forced ?? clipAt(lane, time);
    if (!clip) continue;
    (out ??= []).push(clip);
  }
  return out ?? NO_CLIPS;
}

const EMPTY: EffectInstance[] = [];
const NO_CLIPS: FxClip[] = [];

export interface FxEffectSourceOptions {
  /**
   * Serve static clips as cached deep clones, so the export can write each
   * frame's audio-link values into the chain it renders without those values
   * landing in the clips the user is still editing. Same contract
   * createSequenceEffectSource offers for static segments.
   */
  clone?: boolean;
}

/**
 * Time → stacked chain resolver. Preview and export both build one of these,
 * so a frame that was scrubbed past is the frame that gets written out:
 * interval rolls are keyed by (clip, seed, tick, mosh options), which makes a
 * fresh source built from the same inputs reproduce the preview exactly.
 *
 * Returns a shared empty array when nothing is active, so the common "no fx
 * lanes here" frame doesn't mint an array the render loop has to re-check.
 */
export function createFxEffectSource(
  getLanes: () => FxLane[] | null | undefined,
  getMoshOptions: () => MoshOptions,
  { clone = false }: FxEffectSourceOptions = {},
): (time: number, forceClipId?: string | null) => EffectInstance[] {
  const cache = new Map<string, EffectInstance[]>();
  return (time: number, forceClipId?: string | null) => {
    const clips = activeFxClips(getLanes(), time, forceClipId);
    if (clips.length === 0) return EMPTY;
    let out: EffectInstance[] | null = null;
    for (const clip of clips) {
      (out ??= []).push(...chainFor(clip, time, cache, clone, getMoshOptions));
    }
    return out ?? EMPTY;
  };
}

function chainFor(
  clip: FxClip,
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
      cloned = cloneFxEffects(clip.effects);
      cache.set(clip.id, cloned);
    }
    return cloned;
  }

  const options = getMoshOptions();
  const tick = fxClipTick(clip, time);
  const seed = (clip.seed ?? 0) + tick * 7919;
  // Options participate in the key so a settings change can't serve rolls
  // generated under different mosh parameters — the preview/export mismatch
  // createSequenceEffectSource guards against for the same reason.
  const key = `${clip.id}:${seed}:${options.moshMin}:${options.moshMax}:${options.randomizeOrder}:${options.moshAudioLink}:${options.moshAudioLinkStrength}:${options.moshLinkBand}:${options.hasAudio}`;
  let effects = cache.get(key);
  if (!effects) {
    effects = rollEffects(seed, options);
    if (cache.size > 512) cache.clear();
    cache.set(key, effects);
  }
  return effects;
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
  return lanes.map((lane) => {
    if (!lane.clips.some((c) => clipIds.has(c.id))) return lane;
    return { ...lane, clips: lane.clips.map((c) => (clipIds.has(c.id) ? fn(c) : c)) };
  });
}

/**
 * Switch clips to a re-roll mode. Going to "interval" mints a seed if there
 * isn't one, so the rolls are reproducible from the moment it's turned on;
 * going back to "static" keeps the last concrete chain rather than blanking it.
 */
export function setFxClipsMode(
  lanes: FxLane[],
  clipIds: Set<string>,
  mode: SequenceSegmentMode,
  intervalSec?: number,
  intervalBeats?: number | null,
): FxLane[] {
  return updateFxClips(lanes, clipIds, (clip) => {
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
        intervalBeats === null ? undefined : (intervalBeats ?? clip.intervalBeats),
    };
  });
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
  return updateFxClips(lanes, clipIds, (clip) => {
    if (clip.mode === "interval") return { ...clip, seed: randomSeed() };
    return {
      ...clip,
      effects: rollEffects(randomSeed(), options),
      label: "mosh",
      presetName: undefined,
      modified: false,
    };
  });
}

/** Reset clips to an all-disabled chain. */
export function clearFxClips(lanes: FxLane[], clipIds: Set<string>): FxLane[] {
  return updateFxClips(lanes, clipIds, (clip) => ({
    ...clip,
    mode: "static",
    effects: cleanEffects(),
    label: "clean",
    presetName: undefined,
    modified: false,
  }));
}

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
export function cloneFxEffects(effects: EffectInstance[]): EffectInstance[] {
  return effects.map(cloneEffectInstance);
}

/** Fill in anything a saved lane list predates or dropped. */
export function normalizeFxLanes(raw: unknown): FxLane[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((lane: Partial<FxLane>, i) => ({
    id: lane.id ?? generateId(),
    name: lane.name ?? `FX ${i + 1}`,
    enabled: lane.enabled !== false,
    clips: (Array.isArray(lane.clips) ? lane.clips : [])
      // A clip with no chain would be an invisible span that still takes up
      // room on the lane; drop it rather than resurrect it empty.
      .filter((c: Partial<FxClip>) => Array.isArray(c.effects))
      .map((clip: FxClip) => ({
        id: clip.id ?? generateId(),
        start: clip.start ?? 0,
        end: clip.end ?? 0,
        label: clip.label ?? "clean",
        mode: clip.mode === "interval" ? "interval" : ("static" as SequenceSegmentMode),
        presetName: clip.presetName,
        modified: clip.modified,
        effects: clip.effects,
        intervalSec: clip.intervalSec,
        intervalBeats: clip.intervalBeats,
        seed: clip.seed,
      })),
  }));
}

/**
 * Re-derive `intervalSec` for every clip whose interval was set in beats, so
 * correcting the BPM retimes them. Returns the input by identity when nothing
 * moves, so callers can skip a redundant commit — the same contract
 * applyBpmToSegments holds for the source lane.
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
