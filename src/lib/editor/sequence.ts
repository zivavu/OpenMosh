import {
  cloneEffectInstance,
  generateId,
  loadInitialEffects,
  type EffectInstance,
} from "../effects";
import { generateMosh, type MoshOptions } from "./mosh";

export type SequenceSegmentMode = "static" | "interval";

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
