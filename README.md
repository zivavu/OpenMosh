# OpenMosh

Browser-based glitch art studio, inspired by PhotoMosh. It's a fully client-side image and video tool — drop in a photo or video, layer GPU effects, sync them to music, or sequence images into a beat-matched slideshow, then export as a still or a WebM.

> [!WARNING]
> **Epilepsy warning:** the videos below and the app itself produce rapidly flashing images and stroboscopic effects. Use with caution if you're sensitive to flashing lights or have photosensitive epilepsy.


https://github.com/user-attachments/assets/ce69b06b-1d9a-4d72-8518-e86f14cfdaa2

https://github.com/user-attachments/assets/e1f3a112-63ce-4a7c-bb64-a89ee9c21453

https://github.com/user-attachments/assets/3f39413c-5e67-4250-9982-c5bbe60aae23

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

## How it works

There are two editing modes.

The **single editor** loads one image or video at a time. Hit Mosh to build a random stack of glitch effects, tweak them individually, lock the ones you like and re-roll the rest. You can load a music track and link any effect parameter to a frequency band so it reacts to the beat, both in preview and in the final export.

**Slideshow mode** sequences a batch of images to a track instead. Drop the song in and OpenMosh detects its BPM automatically, then flashes images in time with the beat using whatever effect mode you pick — random per beat, one consistent stack, a slow drift, or a preset per image. Transitions, text overlays, and a bit of fake object-tracking are layered on top if you want them.

Everything renders in WebGL2 and exports to WebM (audio included) — no MP4 or GIF support, by design.

Keyboard shortcuts are listed in the app itself under the shortcuts button.

---

## License

[MIT](LICENSE)
