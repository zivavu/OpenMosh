import {
  cloneEffectInstance,
  generateId,
  loadInitialEffects,
  type EffectInstance,
} from "../effects";
import { generateMosh, type MoshOptions } from "./mosh";

export type SequenceSegmentMode = "static" | "interval";

/** Artistic blend rendered between two segments' effect chains. */
export type TransitionType =
  | "cut"
  | "dissolve"
  | "static"
  | "wipe"
  | "blocks"
  | "rgbslip";

export interface SegmentTransition {
  type: TransitionType;
  /** Seconds the blend runs after the boundary. */
  durationSec: number;
  /** Seeded layouts (static/blocks/wipe) stay identical between preview/export. */
  seed: number;
  /** "wipe": 0=→ 1=← 2=↓ 3=↑. */
  direction?: number;
  /** "static"/"blocks" cell size: 0=coarse 1=medium 2=fine. */
  density?: number;
}

/** UI metadata for the transition picker. */
export const TRANSITION_OPTIONS: {
  value: TransitionType;
  label: string;
  hasDirection?: boolean;
  hasDensity?: boolean;
  hasSeed?: boolean;
}[] = [
  { value: "cut", label: "cut" },
  { value: "dissolve", label: "dissolve" },
  { value: "static", label: "static", hasDensity: true, hasSeed: true },
  { value: "wipe", label: "wipe", hasDirection: true, hasSeed: true },
  { value: "blocks", label: "blocks", hasDensity: true, hasSeed: true },
  { value: "rgbslip", label: "rgb slip" },
];

export const DEFAULT_TRANSITION_DURATION = 0.3;

export function createTransition(type: TransitionType): SegmentTransition {
  return { type, durationSec: DEFAULT_TRANSITION_DURATION, seed: randomSeed() };
}

/**
 * A time span of the source video with its own effect state.
 * "static": `effects` is the concrete, user-editable state for the whole span.
 * "interval": effects are re-rolled deterministically every `intervalSec`
 * from `seed`, so preview and export always look identical.
 */
export interface SequenceSegment {
  id: string;
  /** Seconds from video start where this segment begins. */
  startTime: number;
  /** Optional end (seconds); null/undefined = until next segment / video end. */
  endTime?: number | null;
  mode: SequenceSegmentMode;
  /** Display label: preset name, "mosh", "clean", … */
  label: string;
  /** Name of the preset this segment was filled from; used to re-sync the
   * segment when the user explicitly overwrites that preset. */
  presetName?: string;
  /** True once the user hand-edits a preset-filled segment: the label shows
   * "name*" and explicit preset overwrites no longer clobber the edits. */
  modified?: boolean;
  effects: EffectInstance[];
  /** "interval" mode: seconds between re-rolls. */
  intervalSec?: number;
  /** "interval" mode: base seed for per-tick rolls. */
  seed?: number;
  /** Blend rendered when entering this segment from the previous one. */
  transition?: SegmentTransition;
  /** "interval" mode: also blend at each re-roll tick inside the segment. */
  transitionOnTick?: boolean;
}

export const DEFAULT_INTERVAL_SEC = 0.25;

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run fn with Math.random temporarily replaced by a seeded PRNG. Lets the
 * existing mosh generator (which draws from Math.random throughout) produce
 * reproducible results without a parallel seeded implementation.
 */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/** Fresh all-disabled effect list (respects hidden effects). */
export function cleanEffects(): EffectInstance[] {
  return loadInitialEffects();
}

/** Deterministic mosh roll: same seed + options → same effects. */
export function rollEffects(
  seed: number,
  options: MoshOptions,
): EffectInstance[] {
  const effects = loadInitialEffects();
  withSeededRandom(seed, () => generateMosh(effects, options));
  return effects;
}

export function createSequenceSegment(
  startTime: number,
  endTime?: number | null,
): SequenceSegment {
  return {
    id: generateId(),
    startTime,
    endTime,
    mode: "static",
    label: "clean",
    effects: cleanEffects(),
  };
}

/** Copy a segment into a new time span (used when splitting). */
export function cloneSegmentForSplit(
  seg: SequenceSegment,
  startTime: number,
  endTime: number | null,
): SequenceSegment {
  return {
    ...seg,
    id: generateId(),
    startTime,
    endTime,
    effects: seg.effects.map(cloneEffectInstance),
  };
}

export function findSegmentAt(
  segments: SequenceSegment[],
  time: number,
  duration: number,
): SequenceSegment | null {
  let hit: SequenceSegment | null = null;
  for (const s of segments) {
    const end = s.endTime ?? duration;
    if (time >= s.startTime && time < end) {
      if (!hit || s.startTime > hit.startTime) hit = s;
    }
  }
  return hit;
}

/** 0-based re-roll tick index inside an interval segment. */
export function segmentTick(seg: SequenceSegment, time: number): number {
  const interval = seg.intervalSec ?? DEFAULT_INTERVAL_SEC;
  return Math.max(0, Math.floor((time - seg.startTime) / interval));
}

export interface SequenceEffectSourceOptions {
  /**
   * When true, static segments are served as cached deep clones so the
   * consumer (export audio tick) can mutate values without touching the
   * user's editable segment state.
   */
  cloneStatic?: boolean;
}

/**
 * Time → effects resolver over a segment list. Interval rolls are cached by
 * (segment, seed, tick, mosh options) so repeated frames are cheap and a
 * fresh source built with the same inputs (e.g. at export) reproduces
 * exactly what the preview showed.
 */
export function createSequenceEffectSource(
  getSegments: () => SequenceSegment[],
  getDuration: () => number,
  getMoshOptions: () => MoshOptions,
  { cloneStatic = false }: SequenceEffectSourceOptions = {},
): (time: number) => EffectInstance[] | null {
  const cache = new Map<string, EffectInstance[]>();
  return (time: number) => {
    const seg = findSegmentAt(getSegments(), time, getDuration());
    if (!seg) return null;

    if (seg.mode === "static") {
      if (!cloneStatic) return seg.effects;
      let cloned = cache.get(seg.id);
      if (!cloned) {
        cloned = seg.effects.map(cloneEffectInstance);
        cache.set(seg.id, cloned);
      }
      return cloned;
    }

    const options = getMoshOptions();
    const tick = segmentTick(seg, time);
    const seed = (seg.seed ?? 0) + tick * 7919;
    // Options participate in the key so settings changes don't serve rolls
    // generated under different mosh parameters (preview/export mismatch).
    const key = `${seg.id}:${seed}:${options.moshMin}:${options.moshMax}:${options.randomizeOrder}:${options.moshAudioLink}:${options.moshAudioLinkStrength}:${options.hasAudio}`;
    let effects = cache.get(key);
    if (!effects) {
      effects = rollEffects(seed, options);
      if (cache.size > 512) cache.clear();
      cache.set(key, effects);
    }
    return effects;
  };
}

export interface ResolvedTransition {
  /** Outgoing chain (state just before the boundary). */
  effectsA: EffectInstance[];
  /** Master time where the blend starts. */
  boundaryTime: number;
  transition: SegmentTransition;
}

/**
 * Resolve the active transition at `time`, if any: the segment under the
 * playhead must declare a non-cut transition and the playhead must sit within
 * `durationSec` after the boundary (the segment start, or — for interval
 * segments with transitionOnTick — the latest re-roll tick). The outgoing
 * chain is sampled deterministically just before the boundary so preview and
 * export blend from exactly the same state. Progress is left to the caller:
 * (time - boundaryTime) / transition.durationSec.
 */
export function resolveTransitionAt(
  segments: SequenceSegment[],
  time: number,
  duration: number,
  effectsAt: (t: number) => EffectInstance[] | null,
): ResolvedTransition | null {
  const seg = findSegmentAt(segments, time, duration);
  if (!seg?.transition || seg.transition.type === "cut") return null;
  const dur = seg.transition.durationSec;
  if (dur <= 0) return null;

  let boundary = seg.startTime;
  if (seg.mode === "interval" && seg.transitionOnTick) {
    const tick = segmentTick(seg, time);
    if (tick > 0) {
      boundary = seg.startTime + tick * (seg.intervalSec ?? DEFAULT_INTERVAL_SEC);
    }
  }

  const elapsed = time - boundary;
  if (elapsed < 0 || elapsed >= dur) return null;

  const effectsA = effectsAt(boundary - 0.001);
  if (!effectsA) return null;
  return { effectsA, boundaryTime: boundary, transition: seg.transition };
}
