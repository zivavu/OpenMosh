# OpenMosh

Browser-based glitch art studio, inspired by PhotoMosh. It's a fully client-side image and video tool — drop in a photo or video, layer GPU effects, sync them to music, or sequence images into a beat-matched slideshow, then export as a still or a WebM.

---

## Getting started

OpenMosh uses [bun](https://bun.sh) as its package manager and runtime.

```bash
bun install        # Install dependencies
bun dev            # Start dev server (Vite)
bun build          # Production build
bun preview        # Preview the production build
bun check          # TypeScript + Svelte type-check (svelte-check + tsc)
```

Built with Svelte 5, Vite, TypeScript, and WebGL2. Uses `mediabunny` for WebM muxing and `essentia.js` for BPM detection.

---

## How to use it

There are two editing modes.

The **single editor** loads one image or video at a time. Hit Mosh to build a random stack of glitch effects, tweak them individually. You can load some music and link any effect parameter to a frequency band so it reacts to the beat. There also is a sequence timeline mode in which you can arrange effects over time(work in progress).

**Slideshow mode** uses a batch of images or videos to a track instead.

Everything renders in WebGL2 and exports to WebM (audio included) — no MP4 or GIF support.

Keyboard shortcuts are listed in the app under the shortcuts button.

---

## What can it produce?

> [!WARNING]
> **Epilepsy warning:** the videos below and the app itself produce rapidly flashing images and stroboscopic effects. Use with caution if you're sensitive to flashing lights or have photosensitive epilepsy.

https://github.com/user-attachments/assets/ce69b06b-1d9a-4d72-8518-e86f14cfdaa2

https://github.com/user-attachments/assets/e1f3a112-63ce-4a7c-bb64-a89ee9c21453

https://github.com/user-attachments/assets/3f39413c-5e67-4250-9982-c5bbe60aae23


## License

[MIT](LICENSE)
