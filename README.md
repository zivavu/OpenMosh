# OpenMosh
[openmosh-1781080776074.webm](https://github.com/user-attachments/assets/e1f3a112-63ce-4a7c-bb64-a89ee9c21453)

> [!WARNING]
> **Epilepsy warning:** The video above and the app itself produce rapidly flashing images and stroboscopic effects. Use with caution if you are sensitive to flashing lights or have photosensitive epilepsy.


> Browser-based glitch art studio — inspired by PhotoMosh.

OpenMosh is a fully client-side image and video glitch tool. Drop in a photo or video, layer GPU effects, sync them to music, or sequence images into a beat-matched slideshow — then export as a still (PNG/JPG) or video (WebM). 

---

## Features

- **39 GPU effects** across distortion, color/tone, artifact, motion, and temporal (feedback) categories — all rendered in WebGL2.
- **Mosh button** — randomly enables and randomizes a stack of effects for instant glitch results. Lock the ones you like; re-roll the rest.
- **Audio reactivity** — link any effect parameter to a frequency band (low/mid/high/full) of a music track so it pulses to the beat. Works in live preview and is baked into exports via offline FFT analysis.
- **Track library** — keep your music tracks on hand with per-track playback spans and loudness normalization.
- **Slideshow mode** — sequence multiple images to music with automatic BPM detection, beat subdivisions, transitions, text overlays, and salient-region tracking.
- **Live preview** with FPS counter, output resize, and span-based looping.
- **Export** stills (PNG/JPG) or video (WebM with muxed audio).
- **Undo/redo history** and **localStorage presets** for effect stacks.

---

## Getting Started

OpenMosh uses [**bun**](https://bun.sh) as its package manager and runtime.

```bash
bun install        # Install dependencies
bun dev            # Start dev server (Vite)
bun build          # Production build
bun preview        # Preview the production build
bun check          # TypeScript + Svelte type-check (svelte-check + tsc)
```

**Tech stack:** Svelte 5 (runes), Vite, TypeScript, WebGL2. Key libraries: `mediabunny` (WebM muxing), `essentia.js` (WASM BPM detection).


---

## Single Editor Workflow

1. **Load** an image or video (PNG, JPG, WebP, GIF, HEIC, MP4, WebM, MOV).
2. **Mosh** — hit the Mosh button (or `→`) to randomly build an effect stack. Each press either redoes a forward step in history or rolls a fresh stack.
3. **Tune** effects in the side panel: toggle, reorder (drag), lock, expand to adjust parameters, and save/load presets.
4. **Add music** (optional) and link parameters to audio so the glitch reacts to the beat.
5. **Set the export span** on the timeline (the looping region used for both preview and recording).
6. **Export** — Save a still or Record a WebM.

### Effects panel

- Each effect row can be **enabled/disabled**, **locked** (immune to Mosh re-rolls), **expanded** for its parameters, and **drag-reordered** to change the render order.
- **Volume links**: when a track is loaded, any range parameter can be linked to an audio level. Choose a frequency band (full / low 20–250 Hz / mid 250–4000 Hz / high 4000–20000 Hz) and an output min/max; the parameter is then driven by that band's live level.
- **Presets** are saved to `localStorage` (`openmosh-presets`).

### Mosh settings

Configure how aggressive Mosh is: minimum/maximum number of effects enabled per roll, whether to randomize order, and whether to auto-link ~some parameters to audio (with an adjustable strength). Settings persist to `localStorage` (`openmosh-settings`).

### Audio & the timeline

- Load a track via the **track library** or by dragging an audio file onto the canvas.
- The **timeline** shows the track (or video) with a draggable **span** (start/end handles) that defines the loop and export region, a playhead, play/pause, and an output volume control.
- Tracks support **loudness normalization** and per-track saved spans.
- For videos, the video's own audio is used unless an explicit music track is attached (which mutes the video).

### Output size & format

- **Resize** the rendered output independently of the source resolution.
- **Format toggle**: `PNG` / `JPG` (still image — Save button) or `WebM` (video — Record). On mobile the default is PNG.

### Recording (WebM)

- Choose **FPS** (15/24/30/60/120). Duration follows the timeline span when a track or video is present, otherwise a manual duration slider (1–30s).
- During export the audio track is decoded **offline**, per-frame FFT spectra are precomputed, and audio-linked parameters are applied to each rendered frame — so the recording matches what you hear. Audio is muxed into the WebM (Opus/Vorbis).
- A progress overlay shows capture and finalization, with a Cancel button.

> Note: **MP4 export is intentionally not supported.**

---

## Slideshow Workflow

Slideshow mode sequences multiple images, flashing them in time with music.

1. **Add images** (drag-and-drop or browse) — they appear as a reorderable grid with thumbnails.
2. **Add a track** — OpenMosh auto-detects **BPM** (via `essentia.js` in a Web Worker) and the first-beat offset. Both are editable.
3. **Set the beat subdivision** — how many beats per image flash (e.g. every beat, every half-beat, every 2 beats). **Timeline segments** let you change the subdivision over different regions of the song.
4. **Pick a mosh mode** for how effects vary across beats:
   - `random` — fresh random stack each beat
   - `consistent` — one stack reused throughout
   - `smooth` — drift a few effects per beat (speed-adjustable)
   - `per-image` — assign a preset to each image
5. **Transitions** blend the outgoing and incoming image as a pre-pass before the effect chain runs.
6. **Text overlay** (optional) — flash phrases from a dictionary per beat/frame with configurable style, layout, split, and blend mode.
7. **Tracking** (optional) — detect salient regions to keep subjects framed.
8. **Preview** in the canvas (Space to play/pause), then **export** a WebM where each beat-timed frame is rendered offline with transitions and audio.

---

## Keyboard Shortcuts

### Single editor

| Key | Action |
|-----|--------|
| `→` | Mosh (roll / redo effect stack) |
| `←` or `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + S` | Save current frame (PNG/JPG) |
| `Space` | Play / pause the track or video |
| `V` | Re-input — feed the current rendered frame back in as the new source (effects reset) |

Shortcuts are ignored while typing in an input, textarea, or select.

### Slideshow editor

| Key | Action |
|-----|--------|
| `Space` | Play / pause preview |
| `Esc` | Stop preview |

---

## Architecture Overview

```
src/
├─ App.svelte                  # Hash-routed shell: upload / editor / slideshow
├─ main.ts                     # Entry point (mount())
├─ lib/
│  ├─ components/
│  │  ├─ editor/               # Single editor (Editor, GlCanvas, Mosh/Record groups, overlays)
│  │  ├─ slideshow/            # Slideshow editor, grid, config panel, timeline segments
│  │  └─ ui/                   # Shared UI (effects panel, sliders, timeline, track library, toasts)
│  ├─ effects/                 # Effect data layer (definitions, types, instances, presets)
│  ├─ gl/                      # WebGL2 renderer + GLSL shaders
│  ├─ audio/                   # Real-time + offline audio, track library, manager
│  ├─ editor/                  # Editor logic (mosh, recording, history, keyboard, settings)
│  ├─ slideshow/               # Beat clock, sequencer, BPM detector, slideshow recorder
│  ├─ text-overlay/            # Phrase parsing + canvas text rendering
│  ├─ tracking/                # Saliency detection + region tracking
│  └─ recorder.ts              # WebM export (mediabunny)
```

### Rendering pipeline (`lib/gl/`)

`GlRenderer` is the core. It keeps two pairs of FBOs:

- **Ping-pong FBOs** — intermediate buffers for chaining multi-pass effects.
- **Feedback FBOs** — persist the previous frame for temporal effects that read `u_feedback`.

Each frame, enabled effect instances render in order. Every effect except the last writes to a ping-pong FBO; the last writes to the feedback FBO, which the canvas then draws via a passthrough shader. The canvas uses `preserveDrawingBuffer: true` so frames can be read back for export. `GlRenderer.warmup()` pre-creates a context on the upload screen to avoid a cold start.

### Effect data layer (`lib/effects/`)

- **`EffectDefinition`** — static metadata (id, name, params of type range/select/checkbox).
- **`EffectInstance`** — runtime state (enabled, locked, expanded, current `values`, optional `volumeLinks`).
- **`VolumeLink`** — maps an audio band's level to a parameter's min/max output range.
- All GLSL lives in `effect-shaders.ts`; standard uniforms are `u_texture`, `u_feedback`, `u_time`, `u_flipY`.

### Audio (`lib/audio/`)

- **Live preview** runs audio through a real-time `AnalyserNode`; `applyVolumeLinksTick` mutates effect values each frame.
- **Export** decodes the audio file offline, runs a custom radix-2 FFT, and precomputes per-frame spectra applied before each rendered frame.

### Adding a new effect

1. Add an `EffectDefinition` to `lib/effects/definitions.ts`.
2. Add its GLSL fragment + `EffectShaderDef` to `lib/gl/effect-shaders.ts`.
3. If it animates via `u_time`, add it to the `ANIMATED_EFFECTS` set.

---

## License

[MIT](LICENSE)
