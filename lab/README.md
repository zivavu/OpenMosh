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
  (MIT): Godray, Reflection.

Every header carries `CREDIT`, `LICENSE` and `SOURCE`.
