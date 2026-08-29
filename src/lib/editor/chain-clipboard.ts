/**
 * One clipboard for effect chains, shared by the source lane's segments and the
 * fx lanes' clips.
 *
 * A segment and an fx clip are different things — one says which media plays,
 * the other only adds effects — but the chain and the way it is rolled are
 * identical in both, which is what makes "copy these effects onto that" mean
 * something across the two. So this carries the behaviour they share and
 * nothing else: pasting never moves a segment's media, its transition or its
 * span, because none of that is an effect.
 *
 * Module-level rather than a prop: the two timelines are siblings with mutually
 * exclusive selections (see keepOnlySelection), so a copy in one is always
 * followed by a paste in the other with no common parent state in between.
 *
 * Plain state, no runes: nothing renders from this. Both timelines read it from
 * a keydown handler, which is not a reactive context.
 */

import { cloneEffectInstance, type EffectInstance } from "../effects";
import type { FxClip } from "./fx-lanes";
import type { SequenceSegment, SequenceSegmentMode } from "./sequence";

/** The behaviour a segment and an fx clip both understand. */
export interface ChainClip {
  label: string;
  mode?: SequenceSegmentMode;
  presetName?: string;
  modified?: boolean;
  effects: EffectInstance[];
  intervalSec?: number;
  intervalBeats?: number;
  seed?: number;
}

function capture(src: SequenceSegment | FxClip): ChainClip {
  return {
    label: src.label,
    mode: src.mode,
    presetName: src.presetName,
    modified: src.modified,
    // Cloned on the way in as well as out: the copy has to survive the source
    // being edited or deleted before it is pasted.
    effects: src.effects.map(cloneEffectInstance),
    intervalSec: src.intervalSec,
    intervalBeats: src.intervalBeats,
    seed: src.seed,
  };
}

class ChainClipboard {
  clips: ChainClip[] = [];

  /**
   * Bumped on every copy. The segment timeline keeps its own richer clipboard
   * (whole segments, with their spans and media), so a paste there has to know
   * which of the two was filled last — the same "newest wins" rule Ctrl+Z
   * follows across the undo stacks.
   */
  stamp = 0;

  /** Snapshot chains in the order given; the caller sorts by time. */
  copy(items: (SequenceSegment | FxClip)[]) {
    if (items.length === 0) return false;
    this.clips = items.map(capture);
    this.stamp++;
    return true;
  }

  /** Fresh instance ids each paste, so two pasted copies never share state. */
  at(i: number): ChainClip | null {
    const clip = this.clips[i % this.clips.length];
    if (!clip) return null;
    return { ...clip, effects: clip.effects.map(cloneEffectInstance) };
  }
}

export const chainClipboard = new ChainClipboard();

/**
 * Overwrite what a segment does, keeping what it *is*: its id, its span, the
 * media it plays, and the transition into it all stay put.
 */
export function applyChainToSegment(
  seg: SequenceSegment,
  chain: ChainClip,
): SequenceSegment {
  return {
    ...seg,
    label: chain.label,
    mode: chain.mode ?? "static",
    presetName: chain.presetName,
    modified: chain.modified,
    effects: chain.effects,
    intervalSec: chain.intervalSec,
    intervalBeats: chain.intervalBeats,
    seed: chain.seed,
  };
}

/** The same, for an fx clip: its span and its fade are its own. */
export function applyChainToFxClip(clip: FxClip, chain: ChainClip): FxClip {
  return {
    ...clip,
    label: chain.label,
    mode: chain.mode ?? "static",
    presetName: chain.presetName,
    modified: chain.modified,
    effects: chain.effects,
    intervalSec: chain.intervalSec,
    intervalBeats: chain.intervalBeats,
    seed: chain.seed,
  };
}
