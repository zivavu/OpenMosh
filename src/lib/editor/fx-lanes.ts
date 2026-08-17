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
import { generateMosh, type MoshOptions } from "./mosh";
import {
  beatsToSeconds,
  cleanEffects,
  DEFAULT_INTERVAL_SEC,
  randomSeed,
  rollEffects,
  withSeededRandom,
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
 * A stacked effect layer. Clips within a lane never overlap, so a lane
 * contributes at most one chain at a time and drag/resize stay unambiguous.
 */
export interface FxLane {
  id: string;
  name: string;
  /** Off = the lane contributes nothing, without losing its clips. */
  enabled: boolean;
  /**
   * Effect ids this lane is allowed to use. Undefined = all of them.
   *
   * A stacked lane is usually built for one job — a colour lane, a glitch lane
   * — and a mosh roll drawing from all 39 effects can't respect that. Narrowing
   * the palette makes every roll on the lane stay in character, and keeps its
   * clips' chains short enough to read in the panel.
   */
  palette?: string[];
  clips: FxClip[];
}

/** A lane's allowed chain, all disabled. Honours hidden effects either way. */
export function paletteEffects(palette?: string[]): EffectInstance[] {
  const all = cleanEffects();
  if (!palette) return all;
  const allowed = new Set(palette);
  return all.filter((e) => allowed.has(e.defId));
}

export function createFxClip(
  start: number,
  end: number,
  palette?: string[],
): FxClip {
  return {
    id: generateId(),
    start,
    end,
    mode: "static",
    label: "clean",
    effects: paletteEffects(palette),
  };
}

export function createFxLane(name: string): FxLane {
  return { id: generateId(), name, enabled: true, clips: [] };
}

/**
 * Set a lane's palette and bring every clip on it into line: instances still
 * allowed keep their values and enabled state, newly allowed ones join
 * disabled, and the rest are dropped. Editing the palette is therefore
 * non-destructive to anything that stays in it.
 */
export function setLanePalette(
  lanes: FxLane[],
  laneId: string,
  palette: string[] | undefined,
): FxLane[] {
  return lanes.map((lane) => {
    if (lane.id !== laneId) return lane;
    return {
      ...lane,
      palette,
      clips: lane.clips.map((clip) => {
        const kept = new Map(clip.effects.map((e) => [e.defId, e]));
        return {
          ...clip,
          // Rebuilt from the allowed list rather than filtered in place, so the
          // chain keeps definition order and picks up effects added later.
          effects: paletteEffects(palette).map((fresh) => kept.get(fresh.defId) ?? fresh),
        };
      }),
    };
  });
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
): { lane: FxLane; clip: FxClip }[] {
  if (!lanes || lanes.length === 0) return NO_CLIPS;
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
  return out ?? NO_CLIPS;
}

const EMPTY: EffectInstance[] = [];
const NO_CLIPS: { lane: FxLane; clip: FxClip }[] = [];
const NO_LAYERS: FxLayer[] = [];

/**
 * One lane's contribution for a frame. Structurally the renderer's
 * PostChainLayer: the chain the lane adds, and how strongly it applies.
 */
export interface FxLayer {
  effects: EffectInstance[];
  /** 0 = absent, 1 = fully applied. Below 1 only while a clip's fade ramps. */
  weight: number;
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
 */
export function createFxLayerSource(
  getLanes: () => FxLane[] | null | undefined,
  getMoshOptions: () => MoshOptions,
  { clone = false }: FxEffectSourceOptions = {},
): (time: number, forceClipId?: string | null) => FxLayer[] {
  const cache = new Map<string, EffectInstance[]>();
  return (time: number, forceClipId?: string | null) => {
    const active = activeFxClips(getLanes(), time, forceClipId);
    if (active.length === 0) return NO_LAYERS;
    return active.map(({ lane, clip }) => ({
      effects: chainFor(clip, lane, time, cache, clone, getMoshOptions),
      // A clip pinned in for editing shows at full strength: the fade is about
      // how it enters during playback, and ramping it here would leave the
      // panel adjusting a chain that is only partly on screen.
      weight: clip.id === forceClipId ? 1 : fxClipWeight(clip, time),
    }));
  };
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
  lane: FxLane,
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
  // The palette is in the key too: narrowing a lane has to invalidate the rolls
  // it already served, or the clip would keep replaying effects it no longer
  // allows until the cache happened to turn over.
  const key = `${clip.id}:${seed}:${options.moshMin}:${options.moshMax}:${options.randomizeOrder}:${options.moshAudioLink}:${options.moshAudioLinkStrength}:${options.moshLinkBand}:${options.hasAudio}:${lane.palette?.join(",") ?? "*"}`;
  let effects = cache.get(key);
  if (!effects) {
    effects = rollPaletteEffects(seed, options, lane.palette);
    if (cache.size > 512) cache.clear();
    cache.set(key, effects);
  }
  return effects;
}

/** A seeded mosh roll restricted to a lane's palette. */
function rollPaletteEffects(
  seed: number,
  options: MoshOptions,
  palette?: string[],
): EffectInstance[] {
  if (!palette) return rollEffects(seed, options);
  const effects = paletteEffects(palette);
  withSeededRandom(seed, () => generateMosh(effects, options));
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
  fn: (clip: FxClip, lane: FxLane) => FxClip,
): FxLane[] {
  return lanes.map((lane) => {
    if (!lane.clips.some((c) => clipIds.has(c.id))) return lane;
    return {
      ...lane,
      clips: lane.clips.map((c) => (clipIds.has(c.id) ? fn(c, lane) : c)),
    };
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
  return updateFxClips(lanes, clipIds, (clip, lane) => {
    if (clip.mode === "interval") return { ...clip, seed: randomSeed() };
    return {
      ...clip,
      effects: rollPaletteEffects(randomSeed(), options, lane.palette),
      label: "mosh",
      presetName: undefined,
      modified: false,
    };
  });
}

/** Reset clips to an all-disabled chain, within the lane's palette. */
export function clearFxClips(lanes: FxLane[], clipIds: Set<string>): FxLane[] {
  return updateFxClips(lanes, clipIds, (clip, lane) => ({
    ...clip,
    mode: "static",
    effects: paletteEffects(lane.palette),
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
    // An empty saved palette would mean "no effects allowed", which no UI can
    // produce and which would leave the lane permanently dead; read it as none.
    palette:
      Array.isArray(lane.palette) && lane.palette.length > 0
        ? lane.palette
        : undefined,
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
