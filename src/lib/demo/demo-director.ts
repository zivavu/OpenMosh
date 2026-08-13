/**
 * Drives the upload-screen demo: decides which source is on screen and which
 * effect chain runs on it, on a fixed tempo. No audio is involved — the cadence
 * is pure BPM arithmetic, which looks identical to a real beat sync without
 * shipping a track (or a licence) to go with it.
 */

import { createEffectInstance, getDefinition } from "../effects";
import type { EffectInstance } from "../effects/types";
import { generateMosh } from "../editor/mosh";
import type { UploadMode } from "../editor/settings";

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

/** Beats between cuts, per mode: single lingers on one look, slideshow churns. */
const BEATS_PER_CUT: Record<UploadMode, number> = {
  single: 8,
  sequence: 4,
  slideshow: 2,
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildChain(): EffectInstance[] {
  const ids = new Set<string>([pick(ANIMATED_POOL)]);
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
  /** True on the frame a cut lands, so the caller can re-upload the source. */
  cut: boolean;
}

export interface DemoDirector {
  frameAt(elapsedSeconds: number): DemoFrame;
}

/**
 * Chains are rolled lazily on each cut and cached, so consecutive frames within
 * a cut reuse the same EffectInstance objects — the renderer keys feedback
 * buffers by instanceId, and fresh ids every frame would thrash them.
 */
export function createDemoDirector(
  mode: UploadMode,
  sourceCount: number,
): DemoDirector {
  const cutSeconds = (60 / DEMO_BPM) * BEATS_PER_CUT[mode];
  // Single mode holds one source and only changes its look.
  const advancesSource = mode !== "single";

  let cutIndex = -1;
  let effects: EffectInstance[] = [];

  return {
    frameAt(elapsedSeconds: number): DemoFrame {
      const index = Math.max(0, Math.floor(elapsedSeconds / cutSeconds));
      const cut = index !== cutIndex;
      if (cut) {
        cutIndex = index;
        effects = buildChain();
      }
      return {
        sourceIndex: advancesSource ? index % sourceCount : 0,
        effects,
        cut,
      };
    },
  };
}

/** Ids referenced by the pools that no longer exist — guards against a rename
 * silently emptying the demo. Exported for the check in dev builds only. */
export function missingDemoEffects(): string[] {
  return [...ANIMATED_POOL, ...STATIC_POOL].filter((id) => !getDefinition(id));
}
