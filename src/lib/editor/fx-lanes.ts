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

import type { AudioResponse } from "../audio/auto-range";
import {
  cloneEffectInstance,
  generateId,
  hydrateEffects,
  type EffectInstance,
  type FreqBand,
} from "../effects";
import {
  clipAt,
  MIN_CLIP_LENGTH,
  sortClips,
  type TimelineClip,
} from "../timeline/clips";
import type { MoshOptions } from "./mosh";
import { putRoll } from "./roll-cache";
import type { SegmentMoshSnapshot } from "./segment-mosh-history";
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
  /**
   * Fade the lane's contribution in over this many seconds from the clip's
   * start, and out over the same before its end.
   *
   * Deliberately not the source lane's transition set. Those blend two whole
   * scenes, which needs both sides rendered separately — and a stacked lane has
   * no "other side": before the clip the lane contributes nothing at all. What
   * a clip boundary needs is the chain arriving rather than snapping on, so
   * this scales the parameters of the lane's own effects toward their disabled
   * state instead of compositing anything.
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
  const fade = clip.fadeSec ?? 0;
  if (fade <= 0) return 1;
  // A fade longer than half the clip would have the two ramps overlap and the
  // chain never reach full strength; meeting in the middle is the cap.
  const ramp = Math.min(fade, (clip.end - clip.start) / 2);
  if (ramp <= 0) return 1;
  const inWeight = (time - clip.start) / ramp;
  const outWeight = (clip.end - time) / ramp;
  return Math.max(0, Math.min(1, inWeight, outWeight));
}

/** 0-based re-roll tick index inside an interval clip. */
export function fxClipTick(clip: FxClip, time: number): number {
  const interval = clip.intervalSec ?? DEFAULT_INTERVAL_SEC;
  return Math.max(0, Math.floor((time - clip.start) / interval));
}

/**
 * How one lane rolls its moshes and how its links follow the music.
 *
 * A lane is its own instrument: a slow-breathing wash on lane 1 and a hard
 * per-hit stutter on lane 2 want opposite settings, and one global set could
 * only ever serve one of them. Snapshotted from the editor's settings when the
 * lane is created, then the lane's own.
 */
export interface FxLaneSettings {
  moshMin: number;
  moshMax: number;
  randomizeOrder: boolean;
  moshAudioLink: boolean;
  moshAudioLinkStrength: number;
  moshLinkBand: FreqBand;
  /** How this lane's linked params follow the band they listen to. */
  audioResponse: AudioResponse;
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
  /** Absent on lanes saved before per-lane settings, and on lanes the user has
   * never opened: those follow the editor's settings, as they always did. */
  settings?: FxLaneSettings;
}

/** The options a lane rolls under: its own settings, or the editor's. */
export function laneMoshOptions(
  lane: FxLane,
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
  lane: FxLane,
  fallback: AudioResponse,
): AudioResponse {
  return lane.settings?.audioResponse ?? fallback;
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

export function createFxLane(name: string, settings?: FxLaneSettings): FxLane {
  return { id: generateId(), name, enabled: true, clips: [], settings };
}

/**
 * Most stacked lanes at once. Every enabled effect on a lane is another
 * full-screen pass on top of the segment's own chain, so this is a frame-budget
 * limit rather than a modelling one.
 */
export const MAX_FX_LANES = 5;

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
): FxLane[] {
  if (lanes.length >= MAX_FX_LANES) return lanes;
  const lane = createFxLane(`FX ${lanes.length + 1}`, settings);
  if (duration >= MIN_CLIP_LENGTH) lane.clips = [createFxClip(0, duration)];
  return [...lanes, lane];
}

/**
 * Move a lane to a new index in the stack, which is chain order: the lanes
 * contribute in array order, so this reorders the passes. Returns the input
 * by identity when nothing would move, so callers can skip a history entry.
 * `to` is an insertion index and may equal the length (move to the bottom).
 */
export function moveFxLane(lanes: FxLane[], from: number, to: number): FxLane[] {
  if (
    from === to ||
    from < 0 ||
    from >= lanes.length ||
    to < 0 ||
    to > lanes.length
  ) {
    return lanes;
  }
  const next = [...lanes];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
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
  /** Whose settings this chain rolled under, and whose audio response its
   * links follow. */
  laneId: string;
}

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
      effects: chainFor(clip, time, cache, clone, () =>
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
    if (a[i].effects !== b[i].effects || a[i].weight !== b[i].weight) return false;
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
    putRoll(cache, key, effects);
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
  return lanes.map((lane) => {
    if (!lane.clips.some((c) => clipIds.has(c.id))) return lane;
    // Each lane rolls under its own settings, so one Mosh over a selection
    // spanning lanes gives each lane the mosh it is set up for.
    const laneOptions = laneMoshOptions(lane, options);
    return {
      ...lane,
      clips: lane.clips.map((clip) => {
        if (!clipIds.has(clip.id)) return clip;
        if (clip.mode === "interval") return { ...clip, seed: randomSeed() };
        return {
          ...clip,
          effects: rollEffects(randomSeed(), laneOptions),
          label: "mosh",
          presetName: undefined,
          modified: false,
        };
      }),
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

/**
 * Cut the clip covering `at` into two, matching the source lane's Ctrl+Click
 * split. Both halves keep the chain — deep-copied, so editing one no longer
 * touches the other — along with the mode, interval spacing and seed.
 *
 * Returns the lane unchanged when `at` isn't inside a clip, or when either half
 * would come out shorter than MIN_CLIP_LENGTH.
 */
export function splitFxClipAt(lane: FxLane, at: number): FxLane {
  const clip = clipAt(lane, at);
  if (!clip) return lane;
  if (at - clip.start < MIN_CLIP_LENGTH || clip.end - at < MIN_CLIP_LENGTH) {
    return lane;
  }
  const head: FxClip = {
    ...clip,
    id: generateId(),
    end: at,
    effects: cloneFxEffects(clip.effects),
  };
  const tail: FxClip = {
    ...clip,
    id: generateId(),
    start: at,
    effects: cloneFxEffects(clip.effects),
  };
  return {
    ...lane,
    clips: sortClips([...lane.clips.filter((c) => c.id !== clip.id), head, tail]),
  };
}

/**
 * Put a clip back to a remembered mosh. Timing is deliberately excluded, the
 * same way restoreSegmentMosh leaves a segment's span alone: walking the mosh
 * history must change what a clip renders, never where it sits.
 */
export function restoreFxClipMosh(
  lanes: FxLane[],
  clipId: string,
  snap: SegmentMoshSnapshot,
): FxLane[] {
  return updateFxClips(lanes, new Set([clipId]), (clip) => ({
    ...clip,
    effects: snap.effects.map(cloneEffectInstance),
    seed: snap.seed,
    label: snap.label,
    presetName: snap.presetName,
    modified: snap.modified,
  }));
}

/** The mosh-relevant slice of a clip, for the ←/→ history. */
export function fxClipMoshSnapshot(clip: FxClip): SegmentMoshSnapshot {
  return {
    effects: clip.effects,
    seed: clip.seed,
    label: clip.label,
    presetName: clip.presetName,
    modified: clip.modified,
  };
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
/** A stored settings block is kept only if it is complete — a half-written one
 * would leave the lane rolling under a mix of its own values and the
 * editor's, which is neither of the two things the user set up. */
function normalizeLaneSettings(raw: unknown): FxLaneSettings | undefined {
  const s = raw as Partial<FxLaneSettings> | undefined;
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

export function normalizeFxLanes(raw: unknown): FxLane[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((lane: Partial<FxLane>, i) => ({
    id: lane.id ?? generateId(),
    name: lane.name ?? `FX ${i + 1}`,
    enabled: lane.enabled !== false,
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
        mode: clip.mode === "interval" ? "interval" : ("static" as SequenceSegmentMode),
        presetName: clip.presetName,
        modified: clip.modified,
        effects: hydrateEffects(clip.effects),
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
