# OpenMosh

An open-source image and video glitching app inspired by [PhotoMosh](https://moshpro.app/). Built with Svelte 5, WebGL2, and Vite.

## Features

- **37 real-time WebGL effects** across 5 categories: Distortion, Color/Tone, Artifact, Motion, and Temporal
- **Image & video support** — drag-and-drop PNG, JPEG, WebP, GIF, MP4, WebM, or QuickTime files
- **Audio-reactive effects** — link any effect parameter to audio frequency bands (full, low, mid, high) for music-driven visuals
- **Spectrum visualizer** — 64-bar audio spectrum display
- **Preset system** — save and load effect configurations
- **Drag-and-drop reorder** — rearrange effects in the pipeline
- **Undo/redo history**
- **Export to WebM or GIF**
- **Mosh button** — randomize effects for instant glitch art

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js

### Install & Run

```bash
bun install
bun dev
```

### Build for Production

```bash
bun build
bun preview
```

## Effects

| Category | Effects |
|---|---|
| **Distortion** | Pixelate, Posterize, Solarize, Edges, Mirror, Kaleido, Bulge, Tile, Polar, Slices |
| **Color/Tone** | Bleach, Sharpen, Color Correction, Vignette, Duotone, Thermal, Color Halves |
| **Artifact** | Scanlines, Grain, Channel Split, Emboss, Glow, Data Bend, Pixel Sort, Shatter, Stereoscopic, Smear |
| **Motion** | Jitter, Wobble, Shake, Soft Glitch, Hard Glitch |
| **Temporal** | Optical Flow, VHS, Color Melt, Melt, Fractalize |

## Tech Stack

- [Svelte 5](https://svelte.dev/) — UI framework
- [Vite](https://vite.dev/) — build tool
- [TypeScript](https://www.typescriptlang.org/) — type safety
- WebGL2 — GPU-accelerated effect rendering (ping-pong FBOs, feedback buffers)
- [gifenc](https://github.com/mattdesl/gifenc) — GIF encoding via Web Worker
- [mediabunny](https://github.com/nickaein/mediabunny) — WebM muxing

## License

[MIT](LICENSE)
