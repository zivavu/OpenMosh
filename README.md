# OpenMosh

A browser-based glitch art studio, inspired by PhotoMosh. Drop in a photo or a video, pile on effects until it falls apart, hook the whole mess up to a song, and save the result. Nothing is uploaded anywhere, it all runs in your browser.

**[open-mosh.vercel.app](https://open-mosh.vercel.app/)**

![The OpenMosh upload screen](assets/screenshots/upload.jpg)

---

## Getting started

OpenMosh uses [bun](https://bun.sh) as its package manager and runtime.

```bash
bun install        # Install dependencies
bun dev            # Start dev server (Vite)
bun run build      # Production build
bun preview        # Preview the production build
bun check          # TypeScript + Svelte type-check
bun test           # Unit suite (bun:test)
bun test:e2e       # End-to-end suite (Playwright, tests/e2e)
```

Built with Svelte 5, Vite, TypeScript and WebGL2. `mediabunny` handles WebM muxing, `essentia.js` does the BPM detection.

---

## How to use it

Pick one of three modes on the upload screen.

**Single** takes one image or video. Animated GIFs count as video: they come in as a short clip, so they play, scrub and loop like any other one. Hit Mosh and you get a random stack of glitch effects, which you can then tweak one by one, or lock the good ones and re-roll the rest. Set the mosh style to Curated and a roll picks effects that work together instead: it runs them in a sensible order, lets one of them carry the look, and rolls again when the frame comes out blank. Add a track and any effect parameter can be wired to a frequency band of the song, so the distortion moves with the music.

![Single mode with a moshed image and its signal chain](assets/screenshots/single.png)

**Editor** is a timeline. You upload a batch of media, drop the song in as the master track, then lay clips out on media layers, each with its own mosh: a preset, a fixed mosh, or a re-roll that fires on an interval. Stacked effect lanes run over the whole frame, and a text timeline sits alongside the layers. Any piece of media can be cropped, keyed, erased by hand and run at its own speed, and a layer clip pasted onto another brings its chain along. The timeline is yours to size — drag the split along its top edge, or double-click it to hand the room back — and any lane you are not working on folds to a strip, one at a time or all at once.

![Editor mode, media layers and effect lanes on the timeline](assets/screenshots/editor.png)

**Slideshow** is the fast one. Throw in a pile of images or videos, let it detect the BPM of your track, and it cuts between them on the beat with effects firing on the grid.

There are 68 effects, from the tame ones (pixelate, posterize, blur) through the usual glitch vocabulary (data bend, pixel sort, VHS, channel split) to things that follow motion or the salient region of the frame. Anything with a clock — strobes, rolls, pulses, re-rolls — can run free or lock to the beat of the track. Everything renders in WebGL2 and exports to WebM with audio. No MP4, no GIF.

Keyboard shortcuts live behind the shortcuts button in the app.

## Requirements

A recent Chromium browser (Chrome, Edge, Brave, Arc) is what OpenMosh is built and tested against. Firefox and Safari may load it, but export is the wall: it needs `VideoEncoder`, and support there is newer and patchier.

The browser has to give you:

- WebGL2 with `EXT_color_buffer_float` and a max texture size of at least 4096 — the chain renders through float textures
- WebCodecs (`VideoDecoder` / `VideoEncoder`) with VP8 or VP9 encode, for video sources and for export
- Web Workers, IndexedDB and localStorage

Hardware-wise, anything with a GPU from the last decade previews fine. Export is software VP8 across a worker pool sized off your core count, so a fast multi-core CPU is what makes long exports finish quickly. 8 GB of RAM is comfortable; 4K video sources are the thing most likely to make a machine struggle.

---

## Performance

The chain runs one full-screen shader pass per enabled effect, so cost scales with how many effects are live and with the resolution they run at.

- The preview renders at the size it's displayed, not at the output size. Export switches the renderer to full output resolution for the duration of the capture.
- Video above 1080p gets transcoded to a preview proxy in a worker. OpenMosh times the decode first and picks a 1920 or 1280 long edge depending on how the machine coped. You can turn the proxy off per file when you need to judge the original.
- Export encodes in parallel across worker threads. Chromium runs one software encoder mostly single-pipeline, so more cores means a faster export.

---

## Privacy

Your media never leaves the machine. There is no backend, no account and no upload — files are read straight off disk into the page, everything renders locally, and the export is written by your own browser. Sessions, saved sequences and your track library live in IndexedDB and localStorage on your device.

---

## Status

<!-- x-release-please-start-version -->

Version 0.9.4. Single and slideshow modes are more or less settled. The editor is the part still moving, and an update can change the shape of a saved sequence, so treat old projects there as breakable. See [CHANGELOG.md](CHANGELOG.md) for what each version changed.

<!-- x-release-please-end -->

MP4 and GIF export were both removed on purpose and aren't coming back.

---

## Contributing

Issues and pull requests are welcome. The conventions worth knowing up front:

- bun, not npm or yarn. Svelte 5 runes only.
- Unit tests sit next to what they cover and run under `bun:test`, for pure logic only. Anything that needs a browser API goes in the Playwright suite under `tests/e2e`.
- Run `bun check` and both test suites before opening a PR. `bunx playwright install chromium` once, first time. CI runs the same checks, plus formatting and the build, and a PR can't merge until they pass.
- A new effect needs its `EffectDefinition` in `src/lib/effects/definitions.ts`, its GLSL plus `EffectShaderDef` in `src/lib/gl/effect-shaders.ts`, and an entry in `src/lib/effects/curation.ts` (where it sits in the chain for the Curated mosh style), unless it's `moshable: false`. A unit test catches a missing entry.
- `bun dev` also serves a shader lab at `/lab/` for auditioning open-source ISF shaders on real footage before porting one. It's dev-only and not part of the build; see `lab/README.md`.

### Pull requests and releases

Everything reaches `main` through a pull request. Branch off `main`; one PR can carry several changes. PRs are rebase-merged, so every commit on the branch lands on `main` as it is. Tidy the branch before it goes in: fold fixups into the commit they fix.

Each commit message also becomes a line in the changelog, so write it for the people using the app. It has to be a [conventional commit](https://www.conventionalcommits.org/) with a capitalized subject, and a check on the PR holds every commit to that:

```
feat: Lock effects so moshing leaves them alone
fix: The playhead stays put when the mix changes
```

`feat`, `fix` and `perf` go into the changelog. `refactor`, `docs`, `test`, `ci`, `build`, `chore` and `style` stay out of it. Don't mark a commit as breaking with `!`: every release is a patch bump until 1.0. If a change affects saved projects, say so in its message.

Leave `version` in `package.json` and `CHANGELOG.md` alone. [release-please](https://github.com/googleapis/release-please) keeps a release PR open that bumps both. Merging it tags the version, publishes the GitHub Release and deploys it to [open-mosh.vercel.app](https://open-mosh.vercel.app/). Until then, merged work shows up only on Vercel preview deployments.

---

## Credits

[PhotoMosh](https://photomosh.com/) is what this is chasing. A number of effects are ports: from [X-PostProcessing-Library](https://github.com/QianMo/X-PostProcessing-Library) (RGB Burst, Screen Jump, Sobel Neon) and [Vidvox's ISF-Files](https://github.com/Vidvox/ISF-Files) (HSV Swap, RGB Strobe, Trio Tone, Circle Warp, Pixel Shifter, Ring Warp, Shockwave, Ghosting, Fast Mosh, Resize Glitch, Stylize Glitch, Motion Mask), and the crosswarp, cross zoom and cube transitions in the upload-screen demo come from [gl-transitions](https://gl-transitions.com/), all MIT. [mediabunny](https://github.com/Vanilagy/mediabunny) does the muxing and the proxy transcodes, [essentia.js](https://mtg.github.io/essentia.js/) the BPM detection, and [lucide](https://lucide.dev/) the icons. Type is Archivo and JetBrains Mono via [Fontsource](https://fontsource.org/), plus the display faces in `public/fonts`, all under the SIL Open Font License.

---

## License

[MIT](LICENSE)
