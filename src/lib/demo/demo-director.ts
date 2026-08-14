/**
 * Drives the upload-screen demo: decides which source is on screen and which
 * effect chain runs on it, on a fixed tempo. No audio is involved — the cadence
 * is pure BPM arithmetic, which looks identical to a real beat sync without
 * shipping a track (or a licence) to go with it.
 */

import { createEffectInstance, getDefinition } from "../effects";
import type { EffectInstance } from "../effects/types";
import { generateMosh } from "../editor/mosh";
import { ANIMATED_EFFECTS } from "../gl/effect-shaders";

export const DEMO_BPM = 40;

/** Effects that keep moving between cuts, so the background never sits still.
 * Excludes the per-frame noise ones (shake, jitter): moshed speeds run them at
 * frame rate, which reads as a broken page rather than a designed motion.
 *
 * Every id here must be one the renderer actually animates — this pool supplies
 * each slide's guaranteed movement, so a still effect in it costs that slide
 * its motion entirely. `stillDemoEffects()` guards the list in dev builds. */
const ANIMATED_POOL = [
  "wobble",
  "ripple",
  "swirl",
  "tunnel",
  "vhs",
  "scanlines",
  "tile",
];

/** Stills that give each cut its character. Deliberately excludes the subtle
 * ones (blur, sharpen, colour correction) — at background scale they read as
 * nothing happening — and the novelty ones (ascii, thermal, kaleido, polar),
 * which overwrite the poster with their own gimmick instead of glitching it,
 * and pixelate, which just throws the artwork away. */
const STATIC_POOL = [
  "zoom",
  "glow",
  "posterize",
  "solarize",
  "channel-split",
  "duotone",
  "color-halves",
  "slices",
  "smear",
  "data-bend",
  "pixel-sort",
  "halftone",
  "edges",
  "neon-edges",
  "mirror",
  "bulge",
  "bleach",
  "soft-glitch",
];

/** Every transition the app ships, so the upload screen is an honest sample of
 * what a sequence can do. "cut" is excluded — the demo already cuts whenever a
 * blend is not running. */
const TRANSITION_POOL = [
  "dissolve",
  "wipe",
  "blocks",
  "rgbslip",
  "slam",
  "whip",
  "shatter",
  "echo",
  "burn",
  "roll",
  "bleed",
];

/** How much of the beat the blend occupies. Tuned for how long a blend should
 * feel (~0.45s), not as a fixed share of the bar: at 40 BPM a beat is 1.5s, and
 * the old 0.55 would have stretched every slam and whip past three quarters of
 * a second, which is the sluggishness these were rewritten to fix. */
const TRANSITION_BEATS = 0.3;

/** Sources cut on the beat, never per frame: the posters differ in palette as
 * much as in layout, so swapping them at frame rate is a strobe no chain can
 * sit on top of. The chain rerolls on the same cut — one slide, one mosh — so
 * a poster never arrives wearing the look built for the one before it. */
const BEATS_PER_SOURCE = 1;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildChain(): EffectInstance[] {
  const ids = new Set<string>([pick(ANIMATED_POOL)]);
  // A second animated effect most of the time — one alone reads as a loop.
  if (Math.random() > 0.35) ids.add(pick(ANIMATED_POOL));
  const extras = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < extras; i++) ids.add(pick(STATIC_POOL));

  const chain: EffectInstance[] = [];
  for (const id of ids) {
    const def = getDefinition(id);
    if (def) chain.push(createEffectInstance(def));
  }

  // Every effect in the chain is meant to be on, so mosh the whole set: this
  // reuses the app's own parameter biasing rather than inventing a second one.
  generateMosh(chain, {
    moshMin: chain.length,
    moshMax: chain.length,
    randomizeOrder: false,
    moshAudioLink: false,
    moshAudioLinkStrength: 0,
    hasAudio: false,
  });
  return chain;
}

/** A source change still mid-blend. Null on the frame's `transition` means the
 * poster is simply on screen and a single chain render will do. */
export interface DemoTransition {
  /** Poster being blended out of — goes in the renderer's alt source slot. */
  fromSourceIndex: number;
  /** Chain that was running on the outgoing poster. */
  effects: EffectInstance[];
  type: string;
  /** 0→1 across the blend. */
  progress: number;
  seed: number;
  direction: number;
  density: number;
}

export interface DemoFrame {
  sourceIndex: number;
  effects: EffectInstance[];
  /** Seconds since the demo first started, for the renderer's time uniform. */
  time: number;
  transition: DemoTransition | null;
}

export interface DemoDirector {
  advance(deltaSeconds: number): DemoFrame;
}

/**
 * Chains are rolled lazily on each cut and cached, so consecutive frames within
 * a cut reuse the same EffectInstance objects — the renderer keys feedback
 * buffers by instanceId, and fresh ids every frame would thrash them.
 *
 * The director owns its clock rather than taking one, because it is a shared
 * singleton (see getDemoDirector) and the clock has to survive a caller
 * remounting mid-performance.
 */
function createDemoDirector(sourceCount: number): DemoDirector {
  const beatSeconds = 60 / DEMO_BPM;
  let elapsed = 0;
  let sourceCut = -1;
  let sourceIndex = 0;
  let effects: EffectInstance[] = [];
  /** The blend rolled at the last source cut, replayed until it finishes. */
  let blend: Omit<DemoTransition, "progress"> | null = null;
  let blendStartBeat = 0;

  return {
    advance(deltaSeconds: number): DemoFrame {
      elapsed += Math.max(0, deltaSeconds);
      const beat = elapsed / beatSeconds;

      const nextSourceCut = Math.floor(beat / BEATS_PER_SOURCE);
      if (nextSourceCut !== sourceCut) {
        const first = sourceCut === -1;
        const fromSourceIndex = sourceIndex;
        sourceCut = nextSourceCut;
        sourceIndex = nextSourceCut % sourceCount;
        // Captured before the reroll: the outgoing side of the blend has to
        // keep rendering the chain that was actually on screen.
        const outgoing = effects;
        effects = buildChain();
        // Nothing to blend out of on the very first poster.
        blend = first
          ? null
          : {
              fromSourceIndex,
              effects: outgoing,
              type: pick(TRANSITION_POOL),
              seed: Math.floor(Math.random() * 997),
              direction: Math.floor(Math.random() * 4),
              density: Math.floor(Math.random() * 3),
            };
        blendStartBeat = nextSourceCut * BEATS_PER_SOURCE;
      }

      let transition: DemoTransition | null = null;
      if (blend) {
        const progress = (beat - blendStartBeat) / TRANSITION_BEATS;
        if (progress >= 1) blend = null;
        else transition = { ...blend, progress: Math.max(0, progress) };
      }

      return { sourceIndex, effects, time: elapsed, transition };
    },
  };
}

let shared: { director: DemoDirector; sourceCount: number } | null = null;

/**
 * One director for the whole session. Every upload mode shows the same
 * performance at the same point in it, so switching mode is a no-op for the
 * background rather than a hard cut.
 */
export function getDemoDirector(sourceCount: number): DemoDirector {
  if (!shared || shared.sourceCount !== sourceCount) {
    shared = { director: createDemoDirector(sourceCount), sourceCount };
  }
  return shared.director;
}

/** Ids referenced by the pools that no longer exist — guards against a rename
 * silently emptying the demo. Exported for the check in dev builds only. */
export function missingDemoEffects(): string[] {
  return [...ANIMATED_POOL, ...STATIC_POOL].filter((id) => !getDefinition(id));
}

/** Entries in the animated pool the renderer does not actually animate. Each
 * one is a slide that can come out completely still, since this pool is where
 * the guaranteed movement comes from. Dev builds only. */
export function stillDemoEffects(): string[] {
  return ANIMATED_POOL.filter((id) => !ANIMATED_EFFECTS.has(id));
}
