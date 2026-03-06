# OpenMosh

> Browser-based glitch art studio — inspired by PhotoMosh, built for the modern web.

OpenMosh is a fully client-side image and video glitch tool. Drop in a photo or video, layer effects, sync them to music, sequence slides to a beat, add text overlays, then export as WebM or GIF — all without a server.

---

## Features

### Effects Engine
38 GPU-accelerated effects rendered in WebGL2 via a ping-pong / feedback FBO pipeline:

| Category | Effects |
|---|---|
| Distortion | Pixelate, Posterize, Solarize, Edges, Mirror, Kaleido, Bulge, Tile, Polar, Slices |
| Color / Tone | Bleach, Sharpen, Color Correction, Vignette, Duotone, Thermal, Color Halves |
| Artifact | Scanlines, Grain, Chromatic Aberration, Emboss, RGB Shift, Glow, Data Bend, Pixel Sort |
| Motion | Jitter, Wobble, Shake, Soft Glitch, Hard Glitch |
| Temporal | Optical Flow, Feedback, VHS, Color Melt, Spectral Shift, Melt, Fractalize, Luma Mesh |

Effects can be stacked, reordered, locked, and saved as named presets.

### Audio Reactivity
Any parameter on any effect can be linked to audio. Frequency bands (full / low / mid / high), output range, and intensity are all configurable per-link, and visualised live in a 64-bar spectrum display. The **Mosh** button can automatically scatter random audio links across the stack for instant music-driven chaos.

### Slideshow Mode
Sequence multiple images to music with BPM-synced transitions:
- **BPM detection** — powered by essentia.js (WASM) `RhythmExtractor2013`
- **Beat clock** — schedules frames against `AudioContext.currentTime` for tight sync
- **Mosh modes** — random, consistent, smooth, or per-image param randomisation
- **Beat subdivisions** — snap transitions to fractions of a beat
- **Timeline segments editor** — drag boundary points, rectangle-select, copy/paste, move and delete selected points

### Track Library
A persistent audio library backed by IndexedDB. Add tracks once, preview them inline, and load any track into the editor without re-picking files every session. The panel slides in as an overlay and remembers its open/closed state.

### Text Overlays
Composite animated text onto frames with full control:
- A dictionary of phrases split by sentence, line, or both
- **Block** or **scattered** layout (words placed randomly across the canvas)
- Blend modes: normal, multiply, add, screen, overlay, difference, exclusion, subtract
- Configurable chance per frame, opacity, font, size, alignment, stroke, and invert

### Export
| Format | Details |
|---|---|
| **WebM** | VP8 → VP9 → AV1 video + Opus → Vorbis audio via `mediabunny`; 4 Mbps / 128 kbps |
| **GIF** | Capped at 480 px wide, quantised via `gifenc` in a Web Worker, up to 2 frames queued |

Export runs entirely offline: audio is decoded once, per-frame FFT data is pre-computed, and all volume-linked params are applied frame-by-frame before each WebGL render.

---

## Getting Started

```bash
bun install
bun dev        # http://localhost:5173
bun build      # production build → dist/
bun preview    # preview production build
bun check      # TypeScript + Svelte type-check
```

> **Always use `bun`** — the project does not use npm or yarn.

---

## Architecture

```
src/lib/
├── gl/                   WebGL2 rendering core
│   ├── renderer.ts           GlRenderer — ping-pong FBOs, feedback buffer, effect pipeline
│   ├── effect-shaders.ts     GLSL fragment shaders + uniform setters
│   └── utils.ts              shader compilation helpers
├── effects/              Effect data layer
│   ├── definitions.ts        38 static EffectDefinition descriptors
│   ├── types.ts              EffectInstance, EffectParam, VolumeLink, Preset
│   └── presets.ts            load/save presets (localStorage)
├── audio/                Audio processing
│   ├── audio-controller.ts   real-time Web Audio graph + applyVolumeLinksTick
│   ├── offline-audio.ts      decode + custom radix-2 FFT for export
│   ├── audio-utils.ts        RMS level extraction from FFT bins
│   └── track-library.ts      IndexedDB CRUD for persistent track storage
├── slideshow/            Slideshow / BPM mode
│   ├── sequencer.ts          builds ResolvedFrame array from slides + config
│   ├── beat-clock.ts         BPM-locked frame scheduler
│   ├── bpm-detector.ts       essentia.js WASM BPM detection
│   ├── slideshow-recorder.ts offline export for slideshows
│   └── types.ts              SlideshowConfig, SlideshowSlide, TransitionType
├── text-overlay/         Text overlay system
│   ├── types.ts              TextOverlayConfig, layout/blend/split types
│   ├── render-text.ts        canvas 2D text rendering
│   └── index.ts              public API
├── editor/               Editor business logic (pure functions)
│   ├── mosh.ts               generateMosh, applyRandomAudioLinks, clearEffects
│   ├── recording.ts          export orchestration
│   └── keyboard.ts           keyboard handler factory
├── components/
│   ├── editor/               GlCanvas, EffectsPanel, EffectItem, SpectrumDisplay, …
│   ├── slideshow/            SlideshowEditor, TimelineSegments, SlideshowAudioTimeline, …
│   └── ui/                   UploadScreen, DualRangeSlider, TrackLibrary
├── recorder.ts           WebM (mediabunny) + GIF (worker) export
└── gif-encoder-worker.ts Web Worker — gifenc palette quantisation
```

### Rendering Pipeline

Each frame, enabled effects run in order. Every effect except the last reads from a ping-pong FBO and writes to the other; the last effect writes to the **feedback FBO**, which is also passed as `u_feedback` to temporal effects (Optical Flow, VHS, Melt, …). The canvas is drawn by blitting the feedback texture through a passthrough shader.

Effects with a `speed` parameter accumulate phase independently per-instance, so speed changes never cause visible jumps.

---

## Adding an Effect

1. Add an `EffectDefinition` entry to [`src/lib/effects/definitions.ts`](src/lib/effects/definitions.ts)
2. Add the GLSL fragment shader + `EffectShaderDef` to [`src/lib/gl/effect-shaders.ts`](src/lib/gl/effect-shaders.ts)
3. If the shader uses `u_time` for animation, add its id to `ANIMATED_EFFECTS` in the same file

---

## Tech Stack

| | |
|---|---|
| **Svelte 5** | UI framework — runes only (`$state`, `$derived`, `$effect`, `$props`, `$bindable`) |
| **Vite 8** | Build tool (beta) |
| **TypeScript** | Type safety throughout |
| **WebGL2** | All effects are GPU fragment shaders |
| **Web Audio API** | Real-time FFT + offline audio decode |
| **essentia.js** | WASM-based BPM detection |
| **mediabunny** | WebM muxing |
| **gifenc** | GIF palette quantisation |
| **IndexedDB** | Persistent track library |

---

## License

[MIT](LICENSE)
