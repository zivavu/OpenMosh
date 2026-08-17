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
import { cleanEffects } from "./sequence";

/** One span of extra effects on an fx lane. */
export interface FxClip extends TimelineClip {
  /** Display label: preset name, "mosh", "clean", … */
  label: string;
  /** Preset this clip was filled from, for the same re-sync rule as segments. */
  presetName?: string;
  /** Set once the user hand-edits a preset-filled clip. */
  modified?: boolean;
  effects: EffectInstance[];
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
  return { id: generateId(), start, end, label: "clean", effects: cleanEffects() };
}

export function createFxLane(name: string): FxLane {
  return { id: generateId(), name, enabled: true, clips: [] };
}

/** Add an empty lane, named after its position. */
export function appendFxLane(lanes: FxLane[]): FxLane[] {
  return [...lanes, createFxLane(`FX ${lanes.length + 1}`)];
}

export interface ResolveFxOptions {
  /**
   * Clip being edited in the panel. Its lane contributes it whatever the
   * playhead is over, and a lane holding it contributes nothing else — so a
   * tweak is never invisible because the playhead sits past the clip, and the
   * chain can't carry the same instanceId twice (which would have two passes
   * sharing one feedback buffer). Preview only: export passes no override.
   */
  forceClipId?: string | null;
}

/**
 * The extra effects active at `time`, in lane order — which is chain order, so
 * reordering lanes reorders the passes. Returns a fresh array only when
 * something is active; the empty case returns a shared constant so the common
 * "no fx lanes here" frame doesn't churn the render loop's identity checks.
 */
export function resolveFxEffectsAt(
  lanes: FxLane[] | null | undefined,
  time: number,
  { forceClipId }: ResolveFxOptions = {},
): EffectInstance[] {
  if (!lanes || lanes.length === 0) return EMPTY;
  let out: EffectInstance[] | null = null;
  for (const lane of lanes) {
    if (!lane.enabled) continue;
    const forced = forceClipId
      ? lane.clips.find((c) => c.id === forceClipId)
      : undefined;
    const clip = forced ?? clipAt(lane, time);
    if (!clip) continue;
    (out ??= []).push(...clip.effects);
  }
  return out ?? EMPTY;
}

const EMPTY: EffectInstance[] = [];

/**
 * Time → stacked chain resolver, for the export path.
 *
 * `clone` serves cached deep copies, so the recorder can write each frame's
 * audio-link values into the chain it renders without those values landing in
 * the clips the user is still editing — the same contract
 * createSequenceEffectSource offers for static segments. Cached per clip rather
 * than per frame: a clip's chain is the same objects for its whole span, and
 * re-cloning 39 effects per frame is not.
 */
export function createFxEffectSource(
  getLanes: () => FxLane[] | null | undefined,
  { clone = false }: { clone?: boolean } = {},
): (time: number) => EffectInstance[] {
  const cache = new Map<string, EffectInstance[]>();
  return (time: number) => {
    const lanes = getLanes();
    if (!lanes || lanes.length === 0) return EMPTY;
    let out: EffectInstance[] | null = null;
    for (const lane of lanes) {
      if (!lane.enabled) continue;
      const clip = clipAt(lane, time);
      if (!clip) continue;
      if (!clone) {
        (out ??= []).push(...clip.effects);
        continue;
      }
      let cloned = cache.get(clip.id);
      if (!cloned) {
        cloned = cloneFxEffects(clip.effects);
        cache.set(clip.id, cloned);
      }
      (out ??= []).push(...cloned);
    }
    return out ?? EMPTY;
  };
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
        presetName: clip.presetName,
        modified: clip.modified,
        effects: clip.effects,
      })),
  }));
}
