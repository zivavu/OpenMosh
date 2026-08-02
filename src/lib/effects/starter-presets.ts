import type { Preset } from "./types";

/**
 * Presets seeded into localStorage on first run so a new user has somewhere to
 * start other than a flat list of ~48 effects. Once seeded they are ordinary
 * user presets: editable, overwritable, deletable, and never re-seeded.
 *
 * Every value here must sit inside its param's declared min/max in
 * `definitions.ts` — `applyPreset` merges definition defaults underneath, so
 * params added later fill themselves in.
 */
export const STARTER_PRESETS: Preset[] = [
  {
    name: "VHS Dropout",
    effects: [
      {
        defId: "vhs",
        enabled: true,
        values: { static: 0.35, speed: 1, tracking: 0.55 },
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
      },
      {
        defId: "slices",
        enabled: true,
        values: { count: 14, offset: 28, direction: "horizontal" },
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
      },
      {
        defId: "color-correction",
        enabled: true,
        values: { brightness: 0, contrast: 0.2, hue: 0, saturation: 0.25 },
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
      },
      {
        defId: "duotone",
        enabled: true,
        values: { shadowHue: 265, highlightHue: 175, intensity: 0.55 },
      },
      {
        defId: "glow",
        enabled: true,
        values: { amount: 8, cutoff: 0.25, radius: 8 },
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
      },
      { defId: "posterize", enabled: true, values: { levels: 6 } },
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
      },
      {
        defId: "swirl",
        enabled: true,
        values: { angle: 90, radius: 0.8, speed: 0.3 },
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
      },
      { defId: "bleach", enabled: true, values: { amount: 0.35 } },
      {
        defId: "vignette",
        enabled: true,
        values: { size: 0.55, amount: 0.4 },
      },
    ],
  },
];
