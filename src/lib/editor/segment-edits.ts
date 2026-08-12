import {
  applyPreset,
  cloneEffectInstance,
  loadInitialEffects,
  type Preset,
} from "../effects";
import { shuffleInPlace } from "../utils";
import { generateMosh, type MoshOptions } from "./mosh";
import type { SegmentMoshSnapshot } from "./segment-mosh-history";
import {
  cleanEffects,
  DEFAULT_INTERVAL_SEC,
  randomSeed,
  type SegmentTransitionChange,
  type SequenceSegment,
  type SequenceSegmentMode,
} from "./sequence";

/**
 * Pure transforms over a sequence-segment list, one per editing gesture in the
 * timeline toolbar. Each returns a new list; deciding whether the result is an
 * undoable edit is the caller's business (see SegmentBoundaryController).
 */

const mapIds = (
  segments: SequenceSegment[],
  ids: Set<string>,
  fn: (seg: SequenceSegment) => SequenceSegment,
): SequenceSegment[] => segments.map((s) => (ids.has(s.id) ? fn(s) : s));

/** Fill the selected segments from a preset. */
export function fillSegmentsFromPreset(
  segments: SequenceSegment[],
  ids: Set<string>,
  preset: Preset,
): SequenceSegment[] {
  return mapIds(segments, ids, (s) => ({
    ...s,
    mode: "static",
    label: preset.name,
    presetName: preset.name,
    modified: false,
    effects: applyPreset(preset),
  }));
}

/**
 * A preset was explicitly overwritten — refresh every static segment that was
 * filled from it, so segments track the newest version. Hand-edited
 * ("modified") segments keep their edits.
 */
export function syncSegmentsToPreset(
  segments: SequenceSegment[],
  preset: Preset,
): SequenceSegment[] {
  return segments.map((s) =>
    s.mode === "static" && s.presetName === preset.name && !s.modified
      ? { ...s, label: preset.name, effects: applyPreset(preset) }
      : s,
  );
}

/** Reset the selected segments to a clean (all effects off) static state. */
export function clearSegments(
  segments: SequenceSegment[],
  ids: Set<string>,
): SequenceSegment[] {
  return mapIds(segments, ids, (s) => ({
    ...s,
    mode: "static" as const,
    label: "clean",
    presetName: undefined,
    modified: false,
    effects: cleanEffects(),
  }));
}

export function setSegmentsMode(
  segments: SequenceSegment[],
  ids: Set<string>,
  mode: SequenceSegmentMode,
  intervalSec?: number,
  /** Set when the spacing was picked in beats; null clears a beat spacing back
   * to a plain seconds one. */
  intervalBeats?: number | null,
): SequenceSegment[] {
  return mapIds(segments, ids, (s) => ({
    ...s,
    mode,
    intervalSec: intervalSec ?? s.intervalSec ?? DEFAULT_INTERVAL_SEC,
    intervalBeats:
      intervalBeats === undefined
        ? s.intervalBeats
        : (intervalBeats ?? undefined),
    seed: s.seed ?? randomSeed(),
  }));
}

/**
 * Deal the pool across the given segments at random.
 *
 * Dealt from a shuffled deck rather than picked independently: independent
 * picks clump, and four segments in a row on the same clip reads as a broken
 * shuffle. Every source is used once before any repeats, and the reshuffle
 * never lets one repeat across the seam either.
 *
 * The primary source is stored as `undefined`, the same as assigning it by
 * hand — segments without an explicit source render as the primary.
 */
export function randomizeSegmentSources(
  segments: SequenceSegment[],
  ids: Set<string>,
  sourceIds: string[],
  primaryId?: string | null,
): SequenceSegment[] {
  if (sourceIds.length === 0) return segments;
  let deck: string[] = [];
  let last: string | undefined;
  const deal = (): string => {
    if (deck.length === 0) {
      deck = shuffleInPlace([...sourceIds]);
      if (deck.length > 1 && deck[0] === last) {
        [deck[0], deck[1]] = [deck[1], deck[0]];
      }
    }
    last = deck.shift()!;
    return last;
  };
  return mapIds(segments, ids, (s) => {
    const id = deal();
    return { ...s, sourceId: id === primaryId ? undefined : id };
  });
}

export function applyTransitionChanges(
  segments: SequenceSegment[],
  changes: SegmentTransitionChange[],
): SequenceSegment[] {
  const byId = new Map(changes.map((c) => [c.segmentId, c]));
  return segments.map((s) => {
    const c = byId.get(s.id);
    return c
      ? {
          ...s,
          transition: c.transition ?? undefined,
          transitionOnTick: c.transitionOnTick ?? s.transitionOnTick,
        }
      : s;
  });
}

/**
 * Roll a fresh mosh for each selected segment. Interval segments only take a
 * new seed — their rolls are derived from it deterministically.
 */
export function rollSegments(
  segments: SequenceSegment[],
  ids: Set<string>,
  moshOptions: MoshOptions,
): SequenceSegment[] {
  return mapIds(segments, ids, (s) => {
    if (s.mode === "interval") return { ...s, seed: randomSeed() };
    const effects = loadInitialEffects();
    generateMosh(effects, moshOptions);
    return {
      ...s,
      label: "mosh",
      presetName: undefined,
      modified: false,
      effects,
    };
  });
}

/** Put a segment back to a snapshot taken from its own mosh history. */
export function restoreSegmentMosh(
  segments: SequenceSegment[],
  segId: string,
  snap: SegmentMoshSnapshot,
): SequenceSegment[] {
  return segments.map((s) =>
    s.id === segId
      ? {
          ...s,
          effects: snap.effects.map(cloneEffectInstance),
          seed: snap.seed,
          label: snap.label,
          presetName: snap.presetName,
          modified: snap.modified,
        }
      : s,
  );
}
