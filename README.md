# OpenMosh

A browser-based glitch art studio, inspired by PhotoMosh. Drop in a photo or a video, pile on effects until it falls apart, hook the whole mess up to a song, and save the result. Nothing is uploaded anywhere, it all runs in your browser.

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

Built with Svelte 5, Vite, TypeScript and WebGL2. `mediabunny` handles WebM muxing, `essentia.js` does the BPM detection.

---

## How to use it

Pick one of three modes on the upload screen.

**Single** takes one image or video. Hit Mosh and you get a random stack of glitch effects, which you can then tweak one by one, or lock the good ones and re-roll the rest. Add a track and any effect parameter can be wired to a frequency band of the song, so the distortion moves with the music.

**Sequence** is a timeline. You upload a batch of media, drop the song in as the master track, then cut it into segments and give each one its own source and its own mosh: a preset, a fixed mosh, or a re-roll that fires on an interval. Still rough around the edges and getting worked on. Updates mightho introduce breaking changes.

**Slideshow** is the fast one. Throw in a pile of images or videos, let it detect the BPM of your track, and it cuts between them on the beat with effects firing on the grid.

Everything renders in WebGL2 and exports to WebM with audio. No MP4, no GIF.

Keyboard shortcuts live behind the shortcuts button in the app.

---

## What can it produce?

> [!WARNING]
> **Epilepsy warning:** the videos below and the app itself produce rapidly flashing images and stroboscopic effects. Use with caution if you're sensitive to flashing lights or have photosensitive epilepsy.

https://github.com/user-attachments/assets/ce69b06b-1d9a-4d72-8518-e86f14cfdaa2

https://github.com/user-attachments/assets/e1f3a112-63ce-4a7c-bb64-a89ee9c21453

## License

[MIT](LICENSE)
