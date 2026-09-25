# Changelog

## [0.9.3](https://github.com/zivavu/OpenMosh/compare/v0.9.2...v0.9.3) (2026-09-25)


### Added

* A Curated mosh style that picks effects that work together ([2d69748](https://github.com/zivavu/OpenMosh/commit/2d697487ad87a5f06cfd4a405af8f7749de70ef4))
* Click around the preview to deselect layers ([062952c](https://github.com/zivavu/OpenMosh/commit/062952c6dfba0f6554830d6bb167814e8b24225a))
* The selected layer is highlighted in the preview ([#9](https://github.com/zivavu/OpenMosh/issues/9)) ([6b08e8d](https://github.com/zivavu/OpenMosh/commit/6b08e8ded042c2a713d423734b7bfec6467f3f2f))
* Petri, Circle Warp, Polar and 3D Transform stay out of moshes ([4ebdfbd](https://github.com/zivavu/OpenMosh/commit/4ebdfbd3236fe70e9f1369cf5340cfb7ca6ec57e))
* Pixelate and Halftone stay out of moshes ([b541752](https://github.com/zivavu/OpenMosh/commit/b54175208bba87c9a9e471400a2738c8d5704568))
* Dropping an image on a lane lays down a 20-second clip ([d8ee62c](https://github.com/zivavu/OpenMosh/commit/d8ee62ce1a2d7da23806f7fe3fecb5912bb7abd2))
* Generated Voronoi and Stripes images are smoother and richer ([6eb0fc5](https://github.com/zivavu/OpenMosh/commit/6eb0fc535074c50c239379834035394604c12761))
* The timeline scrolls when you drag a clip past its edge ([#10](https://github.com/zivavu/OpenMosh/issues/10)) ([92a1565](https://github.com/zivavu/OpenMosh/commit/92a1565b95854da3b58e93f977e1e326ee449a2c))
* The upload screen shows the app version, linked to its release notes ([#6](https://github.com/zivavu/OpenMosh/issues/6)) ([c5c5a68](https://github.com/zivavu/OpenMosh/commit/c5c5a6859b8df40a2c5154ef1f79ccd804e242da))


### Fixed

* The selected layer stays selected when you drag over others ([#8](https://github.com/zivavu/OpenMosh/issues/8)) ([43493cd](https://github.com/zivavu/OpenMosh/commit/43493cd87d3323ab40c0b0f9cc184626d556fa78))

## [0.9.2](https://github.com/zivavu/OpenMosh/compare/v0.9.1...v0.9.2) (2026-09-24)


### Added

* Audio lanes in the editor, each with its own volume and mute
* Autosave status in the top bar
* Clip edges snap to where their media runs out
* Copy and paste audio clips, and add empty audio lanes
* Drag clips past the end to make the project longer
* Lock effects so moshing leaves them alone
* Loop audio clips, and see a mark wherever a clip starts over
* New lyrics lanes go on top
* Older editor projects are converted to audio lanes when you open them
* Pick which track the BPM is measured from
* Place text per clip and drag it around on the canvas
* Preview fonts on hover, step through them faster and select them all at once
* Projects have their own length, and shortening it trims clips that cross the new end
* Reopen the last project on reload
* Repeat any clip in the preview with R or the Repeat button
* Shift-drag to select joins, then move or copy them together
* Song projects are listed under their song
* Switch fonts on the beat
* Transitions between media clips, set from the join between two clips
* Video clips keep their sound with them until you detach it
* Volume control on every media clip


### Fixed

* Correct descriptions in the shortcuts list
* The audio clip bar works when nothing is selected
* The playhead stays put when the mix changes
* The selected FX clip isn't forced into the preview anymore
* The volume bar stays steady while you drag it
