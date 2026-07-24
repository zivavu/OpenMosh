import {
  applyPreset,
  cloneEffectInstance,
  loadInitialEffects,
  type Preset,
} from "../effects";
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
): SequenceSegment[] {
  return mapIds(segments, ids, (s) => ({
    ...s,
    mode,
    intervalSec: intervalSec ?? s.intervalSec ?? DEFAULT_INTERVAL_SEC,
    seed: s.seed ?? randomSeed(),
  }));
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
