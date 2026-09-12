# Shader Lab

Dev-only page for auditioning open-source shaders on real footage before
porting anything into the app. Not part of the build.

```
bun dev   →   http://localhost:5173/lab/
```

Drop a video or image on the stage (Shift-drop loads it as "media B", used by
shaders with a second image input such as transitions and light leaks).
Pick a shader on the left, tweak on the right, hold **B** to compare with the
source, star (**F**) what fits, write notes — **Copy shortlist** exports stars
and notes as markdown.

**Compile all** builds every shader once and marks the ones that fail red.

## Contents

- `isf.ts` — a small ISF (Interactive Shader Format) runtime for WebGL2:
  JSON header parsing, `IMG_*` macro expansion, multi-pass with persistent /
  float targets and `WIDTH`/`HEIGHT` expressions, custom `.vs` files.
- `shaders/vidvox/` — filters copied verbatim from
  [Vidvox/ISF-Files](https://github.com/Vidvox/ISF-Files) (MIT). Generators,
  wipes, audio and utility shaders were left out.
- `shaders/ported/` — hand ports to ISF from other MIT/CC0 sources:
  X-PostProcessing-Library (glitch family, pixelizers), AcerolaFX (Kuwahara,
  XDoG, dither, CMYK halftone, CRT), Kino (Tube, Streak, Hatch, Aqua) and two
  godotshaders.com CC0 shaders. Each header carries `CREDIT`, `LICENSE` and
  `SOURCE`; a `NOTES`-style remark in `DESCRIPTION` says where a port had to
  substitute something (e.g. a noise texture).
