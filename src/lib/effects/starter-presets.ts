import type { Preset } from "./types";

/**
 * Presets seeded into localStorage on first run so a new user has somewhere to
 * start other than a flat list of ~48 effects. Once seeded they are ordinary
 * user presets: editable, overwritable, deletable, and never re-seeded.
 *
 * Every value here must sit inside its param's declared min/max in
 * `definitions.ts` — `applyPreset` merges definition defaults underneath, so
 * params added later fill themselves in.
 *
 * Each preset drives one or two "intensity" params from the music via
 * `volumeLinks`. Omitting `freqMin`/`freqMax` links to the full spectrum (the
 * overall RMS level) rather than a single band. The linked range is read as
 * `min + level * (max - min)`, and a normalized track sits around level
 * 0.2–0.5 with peaks near 0.7 — so `min` is the quiet resting look and `max` is
 * set past the loudest expected value to leave headroom. The static `values`
 * below stay meaningful: they're what renders when no track is loaded.
 */
export const STARTER_PRESETS: Preset[] = [
  {
    name: "VHS Dropout",
    effects: [
      {
        defId: "vhs",
        enabled: true,
        values: { static: 0.35, speed: 1, tracking: 0.55 },
        volumeLinks: { tracking: { min: 0.15, max: 1 } },
      },
      {
        defId: "channel-split",
        enabled: true,
        values: {
          mode: "linear",
          amount: 6,
          angle: 0,
          falloff: 0.5,
          speed: 1,
          saturation: 0.5,
        },
        volumeLinks: { amount: { min: 2, max: 26 } },
      },
      {
        defId: "scanlines",
        enabled: true,
        values: { count: 240, amount: 0.35 },
      },
      {
        defId: "grain",
        enabled: true,
        values: { amount: 0.25, rgb: 1, blendMode: "additive" },
      },
    ],
  },
  {
    name: "Datamosh",
    effects: [
      {
        defId: "data-bend",
        enabled: true,
        values: {
          intensity: 45,
          corruption: 0.45,
          channelShift: 0.35,
          speed: 6,
        },
        volumeLinks: { corruption: { min: 0.12, max: 0.85 } },
      },
      {
        defId: "slices",
        enabled: true,
        values: { count: 14, offset: 28, direction: "horizontal" },
        volumeLinks: { offset: { min: 6, max: 70 } },
      },
      {
        defId: "smear",
        enabled: true,
        values: { amount: 0.35, angle: 0 },
      },
    ],
  },
  {
    name: "Pixel Sort",
    effects: [
      {
        defId: "pixel-sort",
        enabled: true,
        values: {
          threshold: 0.35,
          ceiling: 0.9,
          range: 120,
          direction: "horizontal",
          reverse: 0,
        },
        volumeLinks: { range: { min: 20, max: 200 } },
      },
      {
        defId: "color-correction",
        enabled: true,
        values: { brightness: 0, contrast: 0.2, hue: 0, saturation: 0.25 },
        volumeLinks: { contrast: { min: 0.05, max: 0.6 } },
      },
    ],
  },
  {
    name: "Neon Bloom",
    effects: [
      {
        defId: "neon-edges",
        enabled: true,
        values: { strength: 2, glow: 1.6, bg: 0.08 },
        volumeLinks: { strength: { min: 0.8, max: 4 } },
      },
      {
        defId: "duotone",
        enabled: true,
        values: {
          shadowColor: "#20004d",
          highlightColor: "#00ffea",
          intensity: 0.55,
        },
      },
      {
        defId: "glow",
        enabled: true,
        values: { amount: 8, cutoff: 0.25, radius: 8 },
        volumeLinks: { amount: { min: 2, max: 30 } },
      },
    ],
  },
  {
    name: "Thermal Scan",
    effects: [
      {
        defId: "thermal",
        enabled: true,
        values: { intensity: 0.9, palette: "thermal" },
        volumeLinks: { intensity: { min: 0.35, max: 1 } },
      },
      {
        defId: "posterize",
        enabled: true,
        values: { levels: 6 },
        // Inverted: louder collapses the image into fewer, chunkier bands
        volumeLinks: { levels: { min: 3, max: 14, inverted: true } },
      },
      {
        defId: "scanlines",
        enabled: true,
        values: { count: 180, amount: 0.3 },
      },
    ],
  },
  {
    name: "Liquid Dream",
    effects: [
      {
        defId: "liquid-light",
        enabled: true,
        values: { scale: 0.5, flow: 0.45, refraction: 0.6, dispersion: 0.5 },
        volumeLinks: { refraction: { min: 0.2, max: 0.95 } },
      },
      {
        defId: "swirl",
        enabled: true,
        values: { angle: 90, radius: 0.8, speed: 0.3 },
        volumeLinks: { angle: { min: 30, max: 320 } },
      },
      {
        defId: "glow",
        enabled: true,
        values: { amount: 3, cutoff: 0.35, radius: 6 },
      },
    ],
  },
  {
    name: "Halftone Print",
    effects: [
      {
        defId: "halftone",
        enabled: true,
        values: {
          scale: 7,
          angle: 15,
          contrast: 1.2,
          mode: "dots",
          invert: 0,
        },
        volumeLinks: { scale: { min: 4, max: 18 } },
      },
      { defId: "bleach", enabled: true, values: { amount: 0.35 } },
      {
        defId: "vignette",
        enabled: true,
        values: { size: 0.55, amount: 0.4 },
        volumeLinks: { amount: { min: 0.15, max: 0.8 } },
      },
    ],
  },
];
