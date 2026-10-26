# Shader Lab

Dev-only page for auditioning open-source shaders on real footage before
porting anything into the app. Not part of the build.

```
bun dev   →   http://localhost:5173/lab/
```

Drop a video or image on the stage (Shift-drop loads it as "media B", used by
transitions as `endImage`). Pick a shader on the left, tweak on the right, hold
**B** to compare with the source, star (**F**) what fits, write notes —
**Copy shortlist** exports stars and notes as markdown.

**Compile all** builds every shader once and marks the ones that fail red.

## Contents

- `isf.ts` — a small ISF (Interactive Shader Format) runtime for WebGL2:
  JSON header parsing, `IMG_*` macro expansion, multi-pass with persistent /
  float targets and `WIDTH`/`HEIGHT` expressions, custom `.vs` files.
- `shaders/keijiro/` — hand ports from Keijiro Takahashi's Unity effects
  (Unlicense): KinoDatamosh, FlashGlitch, KinoFeedback. Ports that had to
  substitute something (camera motion vectors, manual triggers) say so in
  `DESCRIPTION`.
- `shaders/gl-transitions/` — transitions from
  [gl-transitions](https://github.com/gl-transitions/gl-transitions) (MIT),
  wrapped as ISF with `startImage`/`endImage` and a `progress` slider.
- `shaders/pixi/` — ports from [pixi-filters](https://github.com/pixijs/filters)
  (MIT): Godray, Reflection, Old Film, Tilt Shift, Motion Blur.
- `shaders/glfx/` — ports from [glfx.js](https://github.com/evanw/glfx.js) (MIT):
  Ink, Lens Blur.
- `shaders/pmndrs/` — from [postprocessing](https://github.com/pmndrs/postprocessing)
  (Zlib): Lens Distortion.
- `shaders/libretro/` — Timothy Lottes' public-domain CRT, from
  [libretro/glsl-shaders](https://github.com/libretro/glsl-shaders).
- `shaders/originals/` — written for OpenMosh (MIT), not ports.

Every header carries `CREDIT`, `LICENSE` and `SOURCE` (originals have no `SOURCE`).

## Verify

`bun lab/verify/run.ts [filter] [--big]` serves the repo on 5183 (`E2E_PORT`
overrides it), runs every shader over a second of animated test footage in
headless Chromium and prints one line each. A shader fails if it doesn't compile,
or if its output at default settings is flat, black, or no different from the
source. Contact sheets go to `/tmp/lab-verify`. The filter is comma-separated
path substrings (`originals,keijiro`); `--big` lays the sheets out at full size.
For time-based shaders, `--motion` pans the test scene like a handheld camera,
`--cut` hard-cuts to a second scene halfway, `--strip` keeps three frames per
shader, and `--set=hold:1,gain:2` overrides params by name.
`--app=<effectId>` runs one of the app's own effects through the real renderer
instead, at 120 BPM, and prints its difference from the source frame by frame
(a keyframe shows as a drop to about 0); `--before=shake,zoom` runs other app
effects ahead of it, and `--still` freezes the footage.
Timings come from SwiftShader, so they only compare shaders against each other.

# Generator Lab

`http://localhost:5173/lab/generators/` auditions image generators before any of
them is ported into `src/lib/generators`. Pick a generator, step through seeds
(**←/→**, **Space** for a random one), switch palette and ratio, open a 3×3
contact sheet (**G**), and download a PNG (**D**) to drop into the app. Stars and
notes work as in the shader lab; **Copy shortlist** includes each starred
generator's knob settings.

Each generator is one file in `generators/gens/` that draws onto a 2D canvas
from a seed, a five-ink palette and its own knobs (`generators/kit.ts`). The
shortlisted ones (paper cutout, attractors, flow-field ink) render in WebGL2
through the shared context in `generators/gl.ts`; reaction–diffusion has its
own; the rest are still Canvas 2D or plain typed-array maths.
