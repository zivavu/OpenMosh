# OpenMosh

> Browser-based glitch art studio — inspired by PhotoMosh.

OpenMosh is a fully client-side image and video glitch tool. Drop in a photo or video, layer effects, sync them to music, sequence slides to a beat, add text overlays, then export as WebM or GIF.

---

## Features

### Effects Engine

38 GPU-accelerated effects rendered in WebGL2 via a ping-pong / feedback FBO pipeline:

| Category     | Effects                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| Distortion   | Pixelate, Posterize, Solarize, Edges, Mirror, Kaleido, Bulge, Tile, Polar, Slices      |
| Color / Tone | Bleach, Sharpen, Color Correction, Vignette, Duotone, Thermal, Color Halves            |
| Artifact     | Scanlines, Grain, Chromatic Aberration, Emboss, RGB Shift, Glow, Data Bend, Pixel Sort |
| Motion       | Jitter, Wobble, Shake, Soft Glitch, Hard Glitch                                        |
| Temporal     | Optical Flow, Feedback, VHS, Color Melt, Spectral Shift, Melt, Luma Mesh               |

Effects can be stacked, reordered, locked, and saved as named presets.

### Audio Reactivity

Any parameter on any effect can be linked to audio. Frequency bands (full / low / mid / high), output range, and intensity are all configurable per-link, and visualised in a spectrum display. The **Mosh** button can automatically scatter random audio links across the stack for instant music-driven chaos.

### Slideshow Mode

Sequence multiple images to music with BPM-synced transitions:

- **BPM detection** — powered by essentia.js (WASM) `RhythmExtractor2013`
- **Beat clock** — schedules frames against `AudioContext.currentTime` for tight sync
- **Mosh modes** — random, consistent, smooth, or per-image param randomisation
- **Beat subdivisions** — snap transitions to fractions of a beat
- **Timeline segments editor** — drag boundary points, rectangle-select, copy/paste, move and delete selected points

### Track Library

A persistent audio library backed by IndexedDB. Add tracks once, preview them inline, and load any track into the editor without re-picking files every session. The panel slides in as an overlay and remembers its open/closed state.

## Getting Started

```bash
bun install
bun dev        # http://localhost:5173
bun build      # production build → dist/
bun preview    # preview production build
bun check      # TypeScript + Svelte type-check
```

---

## Adding an Effect

1. Add an `EffectDefinition` entry to [`src/lib/effects/definitions.ts`](src/lib/effects/definitions.ts)
2. Add the GLSL fragment shader + `EffectShaderDef` to [`src/lib/gl/effect-shaders.ts`](src/lib/gl/effect-shaders.ts)
3. If the shader uses `u_time` for animation, add its id to `ANIMATED_EFFECTS` in the same file

---

## Tech Stack

|                   |                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------- |
| **Svelte 5**      | UI framework — runes only (`$state`, `$derived`, `$effect`, `$props`, `$bindable`) |
| **Vite 8**        | Build tool (beta)                                                                  |
| **TypeScript**    | Type safety throughout                                                             |
| **WebGL2**        | All effects are GPU fragment shaders                                               |
| **Web Audio API** | Real-time FFT + offline audio decode                                               |
| **essentia.js**   | WASM-based BPM detection                                                           |
| **mediabunny**    | WebM muxing                                                                        |
| **gifenc**        | GIF palette quantisation                                                           |
| **IndexedDB**     | Persistent track library                                                           |

---

## License

[MIT](LICENSE)
