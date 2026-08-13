/**
 * Drives the upload-screen demo: decides which source is on screen and which
 * effect chain runs on it, on a fixed tempo. No audio is involved — the cadence
 * is pure BPM arithmetic, which looks identical to a real beat sync without
 * shipping a track (or a licence) to go with it.
 */

import { createEffectInstance, getDefinition } from "../effects";
import type { EffectInstance } from "../effects/types";
import { generateMosh } from "../editor/mosh";

export const DEMO_BPM = 120;

/** Effects that keep moving between cuts, so the background never sits still. */
const ANIMATED_POOL = [
  "wobble",
  "ripple",
  "swirl",
  "melt",
  "jitter",
  "shake",
  "zoom",
  "tunnel",
  "vhs",
  "scanlines",
  "kaleido",
  "tile",
  "glow",
];

/** Stills that give each cut its character. Deliberately excludes the subtle
 * ones (blur, sharpen, colour correction) — at background scale they read as
 * nothing happening. */
const STATIC_POOL = [
  "pixelate",
  "posterize",
  "solarize",
  "channel-split",
  "duotone",
  "thermal",
  "color-halves",
  "slices",
  "smear",
  "data-bend",
  "pixel-sort",
  "halftone",
  "ascii",
  "edges",
  "neon-edges",
  "mirror",
  "polar",
  "bulge",
  "bleach",
  "soft-glitch",
];

/** One cadence for every mode: the demo is a single continuous performance, so
 * switching tabs on the upload screen must not restart or re-time it. */
const BEATS_PER_CHAIN = 2;

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

export interface DemoFrame {
  sourceIndex: number;
  effects: EffectInstance[];
  /** Seconds since the demo first started, for the renderer's time uniform. */
  time: number;
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
  let chainCut = -1;
  let sourceIndex = -1;
  let effects: EffectInstance[] = [];

  return {
    advance(deltaSeconds: number): DemoFrame {
      elapsed += Math.max(0, deltaSeconds);
      const beat = elapsed / beatSeconds;

      // One poster per frame: the source itself is the fastest layer of the
      // performance, and the effect chain sits on top at beat tempo.
      sourceIndex = (sourceIndex + 1) % sourceCount;

      const nextChainCut = Math.floor(beat / BEATS_PER_CHAIN);
      if (nextChainCut !== chainCut) {
        chainCut = nextChainCut;
        effects = buildChain();
      }
      return { sourceIndex, effects, time: elapsed };
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
