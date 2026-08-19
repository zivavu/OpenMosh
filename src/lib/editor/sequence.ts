import {
  cloneEffectInstance,
  generateId,
  loadInitialEffects,
  type EffectInstance,
} from "../effects";
import { generateMosh, type MoshOptions } from "./mosh";
import { putRoll } from "./roll-cache";

export type SequenceSegmentMode = "static" | "interval";

/** Artistic blend rendered between two segments' effect chains. */
export type TransitionType =
  | "cut"
  | "rgbslip"
  | "slam"
  | "whip"
  | "shatter"
  | "burn";

export interface SegmentTransition {
  type: TransitionType;
  /** Seconds the blend runs after the boundary. */
  durationSec: number;
  /** Seeded layouts (shatter/whip) stay identical between preview/export. */
  seed: number;
  /** "whip": 0=→ 1=← 2=↓ 3=↑. */
  direction?: number;
  /** "shatter" cell size: 0=coarse 1=medium 2=fine. */
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
  { value: "rgbslip", label: "rgb slip", hasSeed: true },
  { value: "slam", label: "slam" },
  { value: "whip", label: "whip", hasDirection: true, hasSeed: true },
  { value: "shatter", label: "shatter", hasDensity: true, hasSeed: true },
  { value: "burn", label: "burn", hasSeed: true },
];

/** Half a second, not the third it used to be: the reworked shaders all carry
 * a motion beat, and 0.3s cut them off before it read. */
export const DEFAULT_TRANSITION_DURATION = 0.5;

/** One segment's transition edit inside a (possibly multi-segment) change. */
export interface SegmentTransitionChange {
  segmentId: string;
  /** `null` = hard cut. */
  transition: SegmentTransition | null;
  transitionOnTick?: boolean;
}

export function createTransition(type: TransitionType): SegmentTransition {
  return { type, durationSec: DEFAULT_TRANSITION_DURATION, seed: randomSeed() };
}

const LIVE_TRANSITIONS = new Set<string>(TRANSITION_OPTIONS.map((o) => o.value));

/**
 * Anything an earlier save could hold that this build no longer ships
 * ("dissolve", "wipe", "blocks", "echo", "roll", "bleed", the old "static")
 * falls back to a hard cut: none of the survivors stands in closely enough to
 * be worth substituting one blend for another behind the user's back, and a
 * name with no shader would otherwise render as nothing at all.
 */
export function normalizeTransitionType(type: string): TransitionType {
  return LIVE_TRANSITIONS.has(type) ? (type as TransitionType) : "cut";
}

/** Rewrite retired transition names across a timeline read back from storage. */
export function normalizeSegmentTransitions(segments: SequenceSegment[]) {
  for (const seg of segments) {
    if (seg.transition) {
      seg.transition.type = normalizeTransitionType(seg.transition.type);
    }
  }
  return segments;
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
  /** Media this segment draws from. Unset = the primary source (the file the
   * editor was opened with), which is also what pre-multi-source saves mean. */
  sourceId?: string;
  /** Name of the preset this segment was filled from; used to re-sync the
   * segment when the user explicitly overwrites that preset. */
  presetName?: string;
  /** True once the user hand-edits a preset-filled segment: the label shows
   * "name*" and explicit preset overwrites no longer clobber the edits. */
  modified?: boolean;
  effects: EffectInstance[];
  /** "interval" mode: seconds between re-rolls. Always the value the tick math
   * uses, whether it was picked directly or derived from `intervalBeats`. */
  intervalSec?: number;
  /**
   * "interval" mode: the re-roll spacing expressed in beats, when the user
   * picked one. Kept alongside the seconds so a later BPM correction can
   * re-derive them; absent when the interval was picked in seconds.
   */
  intervalBeats?: number;
  /** "interval" mode: base seed for per-tick rolls. */
  seed?: number;
  /** Blend rendered when entering this segment from the previous one. */
  transition?: SegmentTransition;
  /** "interval" mode: also blend at each re-roll tick inside the segment. */
  transitionOnTick?: boolean;
}

export const DEFAULT_INTERVAL_SEC = 0.25;

/**
 * Re-roll spacings offered once a BPM is known, as multiples of a beat.
 * Same ladder and wording as the slideshow's beat divisions.
 */
export const BEAT_INTERVALS: { beats: number; label: string }[] = [
  { beats: 0.03125, label: "1/32 beat" },
  { beats: 0.0625, label: "1/16 beat" },
  { beats: 0.125, label: "1/8 beat" },
  { beats: 0.25, label: "1/4 beat" },
  { beats: 0.5, label: "1/2 beat" },
  { beats: 1, label: "every beat" },
  { beats: 2, label: "every 2 beats" },
  { beats: 4, label: "every 4 beats" },
];

/**
 * Compact wording for a re-roll spacing, for timeline labels. Beat-set
 * intervals read as beats: their seconds are a BPM division, so they print as
 * float noise ("1.1428571428571428s") and change meaning with the BPM.
 */
export function intervalLabel(
  intervalSec: number | undefined,
  intervalBeats?: number | null,
): string {
  if (intervalBeats) {
    if (intervalBeats >= 1) {
      return `${intervalBeats} beat${intervalBeats === 1 ? "" : "s"}`;
    }
    return `1/${Math.round(1 / intervalBeats)} beat`;
  }
  const sec = intervalSec ?? DEFAULT_INTERVAL_SEC;
  // Number() drops the padding zeros toFixed adds to whole values.
  return `${Number(sec.toFixed(3))}s`;
}

/** Seconds between re-rolls for a beat spacing at `bpm`. */
export function beatsToSeconds(beats: number, bpm: number): number {
  if (bpm <= 0) return DEFAULT_INTERVAL_SEC;
  return (60 / bpm) * beats;
}

/**
 * Re-derive `intervalSec` for every segment whose interval was set in beats,
 * so correcting the BPM retimes them. Returns the input by identity when
 * nothing moves, so callers can skip a redundant commit.
 */
export function applyBpmToSegments(
  segments: SequenceSegment[],
  bpm: number,
): SequenceSegment[] {
  if (bpm <= 0) return segments;
  let changed = false;
  const out = segments.map((s) => {
    if (!s.intervalBeats) return s;
    const sec = beatsToSeconds(s.intervalBeats, bpm);
    if (Math.abs((s.intervalSec ?? 0) - sec) < 0.0005) return s;
    changed = true;
    return { ...s, intervalSec: sec };
  });
  return changed ? out : segments;
}

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
    const key = `${seg.id}:${seed}:${options.moshMin}:${options.moshMax}:${options.randomizeOrder}:${options.moshAudioLink}:${options.moshAudioLinkStrength}:${options.moshLinkBand}:${options.hasAudio}`;
    let effects = cache.get(key);
    if (!effects) {
      effects = rollEffects(seed, options);
      putRoll(cache, key, effects);
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
