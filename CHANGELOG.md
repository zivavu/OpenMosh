# Changelog

## [0.9.15](https://github.com/zivavu/OpenMosh/compare/v0.9.14...v0.9.15) (2026-10-10)


### Added

* Add an About page ([b375895](https://github.com/zivavu/OpenMosh/commit/b375895fdc8c222c41b7bd9762c00cc433f43d63))
* Link the Instagram account beside YouTube ([273599a](https://github.com/zivavu/OpenMosh/commit/273599af229e6df42fe33920ce9d7811ded1966a))

## [0.9.14](https://github.com/zivavu/OpenMosh/compare/v0.9.13...v0.9.14) (2026-10-10)

This release is mostly about lanes in the editor. You can copy a media lane from its header, drag audio lanes into a new order, and paste clips under the pointer. A new lane goes in next to the one you last clicked. The eraser now paints with the Mask's brush and has a Softness slider.

### Added

* Copy a media lane, with its clips and effects, from its header ([b497051](https://github.com/zivavu/OpenMosh/commit/b49705193d5845a85e90ccc58742ea7feac7c722))
* Drag audio lanes to reorder them ([eb94005](https://github.com/zivavu/OpenMosh/commit/eb94005f3c638469cf1fe00c1e98da0a2ebc0862))
* Add a new lane next to the one last clicked, and scroll a new media lane into view ([87296dd](https://github.com/zivavu/OpenMosh/commit/87296dd3ce826724657299ee36b7a32fc3e8e535), [ac14aba](https://github.com/zivavu/OpenMosh/commit/ac14aba00dfcc403ef2ab3b765f6bd047e76901c))
* Paste clips where the pointer is ([b953a58](https://github.com/zivavu/OpenMosh/commit/b953a586c3039ca04c74a2650570a30a2adfd18c))
* Scroll the lanes when a dragged clip nears their top or bottom ([13b1122](https://github.com/zivavu/OpenMosh/commit/13b112279457dac3dd0eae0972e7b192b7216502))
* With a mouse, a lane's controls show only while you hover its header. A media lane's solo switch now sits next to its eye. ([ccf8920](https://github.com/zivavu/OpenMosh/commit/ccf89202c5df94f1f8b3ce1e2f8df5ef3bdf7138), [fe59d2e](https://github.com/zivavu/OpenMosh/commit/fe59d2ef1224c477a5295eefa32a861f47f540b1))
* Give the eraser the Mask brush and a Softness slider ([6a0f0e5](https://github.com/zivavu/OpenMosh/commit/6a0f0e5edf6b9496704e7180bee869636d393069))
* Mix more effects into the upload demo ([271f90a](https://github.com/zivavu/OpenMosh/commit/271f90a46d48994b7946b5a30d210ee6ce47354d))
* Show a moshed 404 page for broken links ([2af17c2](https://github.com/zivavu/OpenMosh/commit/2af17c2ad44597861e18aaf7205bf6c186a8a26b))


### Fixed

* Detach the sound of every selected clip, not just one, and keep a pasted clip silent if its sound was detached ([d12c1fd](https://github.com/zivavu/OpenMosh/commit/d12c1fdc7150d1af72c734b06855eb36be4ce401), [d2336cc](https://github.com/zivavu/OpenMosh/commit/d2336cc0206e1035b38794d56b779bb98b22c8be))
* Hide a lane's mute button once its video sound is detached ([93d35a0](https://github.com/zivavu/OpenMosh/commit/93d35a0d8e01f2694a668f013cae652bb92c5f9d))
* Make the Mask brush softer, and equally soft at any speed ([82b11a0](https://github.com/zivavu/OpenMosh/commit/82b11a03d303db1851db5fca0b656f9b93d689a8))
* Show a Mask's area while editing only when Show area is on ([45f1f8a](https://github.com/zivavu/OpenMosh/commit/45f1f8a922c994870ba98ac557a7ba7af83fa110))
* Hide the demo dolphin fully before its leap restarts ([9eab4e4](https://github.com/zivavu/OpenMosh/commit/9eab4e4c54b0aa1fc3d5a995e58cea5f8a5bc8e4))

## [0.9.13](https://github.com/zivavu/OpenMosh/compare/v0.9.12...v0.9.13) (2026-10-09)

This release is mostly about 3D. The editor opens PLY files, point clouds and Gaussian splats, and GLBs compressed with Draco or meshopt. Models show all their textures, play their blend shapes, and let each clip pick which of the file's animations it plays. SVGs come in as image layers that stay sharp at any output size. On the timeline, the project now grows at its start as well as its end, and trimming an audio clip's start works as it does in a DAW.

### Added

* Open PLY files: meshes, point clouds and Gaussian splats. GLB point clouds and triangle strips open too. ([03133a4](https://github.com/zivavu/OpenMosh/commit/03133a4759290c9e7b11918b6a953a61163485cb), [3908c7e](https://github.com/zivavu/OpenMosh/commit/3908c7ebcfda97ce18c7886a610ea0c04ae7d131))
* Open GLBs compressed with Draco or meshopt ([3600237](https://github.com/zivavu/OpenMosh/commit/360023710ed8f11fdd9c540c369950e535eadc99))
* Show every texture a GLB or FBX model carries, not only the first ([16e379e](https://github.com/zivavu/OpenMosh/commit/16e379e21e45c93a2a131547cfe74948c3b7d6f8))
* Pick which of a model's animations each clip plays ([c6732d1](https://github.com/zivavu/OpenMosh/commit/c6732d11b4244b0333739a2746ad8b9f70c00788))
* Play blend-shape animation in GLB models ([f1a91eb](https://github.com/zivavu/OpenMosh/commit/f1a91eba2a04b7c4bd93bc0f9748bd31e4bd20d2))
* Add SVGs as image layers that stay sharp at any output size ([00db876](https://github.com/zivavu/OpenMosh/commit/00db8763e01fb083a366b086531c238cb027df0a))
* Drag a clip, or its start edge, past the start of the project to add time there, the way dragging past the end already did. Fit now trims empty time at the front too. ([bb4e0d2](https://github.com/zivavu/OpenMosh/commit/bb4e0d26cb23957fa49a289f5115d2abbd72d15c), [2406f7a](https://github.com/zivavu/OpenMosh/commit/2406f7a36a81e903c48730f4183bbaf70b332471))
* Trimming an audio clip's start keeps its sound where it is: the edge uncovers or hides the sound instead of sliding it ([77e6bb0](https://github.com/zivavu/OpenMosh/commit/77e6bb0f6984c3ce4b260176867f2c03f69bc5d1))
* Measure the BPM from a video's sound ([d228725](https://github.com/zivavu/OpenMosh/commit/d22872598d41c08e0ec204cbe1946172b992800a))
* Attach a video's sound back to its clip ([8692cf3](https://github.com/zivavu/OpenMosh/commit/8692cf3da33050451d6d1f37b15d670eba66dea2))
* Set every audio link's band at once ([2575472](https://github.com/zivavu/OpenMosh/commit/25754729d7abc6335a64ee763146faf5abfac9c0))


### Fixed

* Line up textures on GLBs that shift their texture coordinates, as files packed with gltfpack do ([beb74c0](https://github.com/zivavu/OpenMosh/commit/beb74c0e27a2b99018a25c50e0d5c4ad5fb2f44c))
* Show see-through images on a checkerboard in the media pool, so a dark logo no longer comes out as a black square ([ebc125c](https://github.com/zivavu/OpenMosh/commit/ebc125c278de4adb7cddcd97389cab17591cb332))
* Zoom out smoothly when a drag grows the project, and keep the scrollbar inside its track ([cbb4c34](https://github.com/zivavu/OpenMosh/commit/cbb4c3475b384ef64a79cc75f7c75ff63b3ae41a))
* Keep the chosen aspect ratio selected after closing settings ([5e0b633](https://github.com/zivavu/OpenMosh/commit/5e0b633e677d442d3ab9dd9c3a79df0479558625))
* Resize as you type in the size fields ([331e681](https://github.com/zivavu/OpenMosh/commit/331e6813dfa421e10a34b74ab89f81a1c2b2b21c))

## [0.9.12](https://github.com/zivavu/OpenMosh/compare/v0.9.11...v0.9.12) (2026-10-08)


### Added

* Auto clips run their own effect chain after the mosh, and you can edit it. In older projects an auto clip keeps only its locked effects and Masks, which is all it ever showed. ([16d3d2e](https://github.com/zivavu/OpenMosh/commit/16d3d2e996b50d1b482727e7fc68abc69a58eae3))
* In Chrome and Edge, Esc clears the selection before it leaves fullscreen. Hold Esc to leave straight away. ([0e84a7f](https://github.com/zivavu/OpenMosh/commit/0e84a7f6cfc78664867bc8eedefb6bb5643eb1fb))
* Tell you what an old save lost when it loads ([ad62acd](https://github.com/zivavu/OpenMosh/commit/ad62acd5d4836db133fb0008b4748db305bac2a2))


### Fixed

* A Mask on a media clip no longer snaps the clip to the middle of the frame, and its shape and Invert work again. ([88772ff](https://github.com/zivavu/OpenMosh/commit/88772ffc1d5e4f18f9c0128c49d4d143282375b7))
* Keep this browser's presets when loading a backup ([0487459](https://github.com/zivavu/OpenMosh/commit/048745952dca1dc5bdd2227d62558be124d33867))


### Faster

* Soloing a media lane no longer slows the preview down. ([727bfb3](https://github.com/zivavu/OpenMosh/commit/727bfb3b1ee2271180c658f1be6d37977a13fdf5))

## [0.9.11](https://github.com/zivavu/OpenMosh/compare/v0.9.10...v0.9.11) (2026-10-07)

This release rebuilds Audio Bars and the way effects follow the music. It also adds a backup: the storage button on the start screen saves every project, preset and setting to one file, which you can load in another browser.

Exports made since 0.9.1 reacted to noise instead of the music, so an exported video's Audio Bars and audio-linked effects didn't match the preview. Export them again to get what the preview shows. Audio Bars in saved projects keep their settings but look different. Effects linked to the music now measure each moment against the whole song, so a quiet intro moves them less than a drop.

### Added

* Back up every project, preset and setting to one file and load it in another browser ([32eb7ec](https://github.com/zivavu/OpenMosh/commit/32eb7ec017e632d2dd9a53314076f38f40e65a6b))
* Spread Audio Bars across the song's range and add falling peaks ([5cba654](https://github.com/zivavu/OpenMosh/commit/5cba654c159e4d3146e2e1d6ff337fc37fc4894e))
* Keep a song's quiet parts quiet in audio links and Audio Bars ([beed0fa](https://github.com/zivavu/OpenMosh/commit/beed0fa65804929d3fd7bced7c6d3223377e5b15))
* Open the editor without a song ([a932abd](https://github.com/zivavu/OpenMosh/commit/a932abd22c11e604b8f7014d0760a5e034954dc8))
* Drag an effect into or out of the live group to switch it ([44bbb47](https://github.com/zivavu/OpenMosh/commit/44bbb4725742d430bc64d8bc2e0e31a641221f48))
* Save the slideshow's frame with Ctrl+S ([6bbfdf8](https://github.com/zivavu/OpenMosh/commit/6bbfdf8798d7bc4f94d55d93b0cb1037a86ec660))
* Keep Audio Bars out of the effect list and moshes until there's music, and out of curated moshes ([9488490](https://github.com/zivavu/OpenMosh/commit/9488490e00159169f388c9e3340d2bd4d2910c46), [5956eb4](https://github.com/zivavu/OpenMosh/commit/5956eb493f56e9bb271589b764191c2dd03ba992))
* Hide effects' beat Sync until there's a song to sync to ([3e6c8db](https://github.com/zivavu/OpenMosh/commit/3e6c8db12a9772774f6637e6bb3930dc8994f06b))
* Try a sample with 5 images in the editor and 20 in a slideshow ([5b2f90b](https://github.com/zivavu/OpenMosh/commit/5b2f90b8f8f3b1c01193dd5f016145a7e3a4e02a))
* Warn Firefox users that playback and export run slower ([9f72383](https://github.com/zivavu/OpenMosh/commit/9f723838ae4da0ab3889ff7fbc9909245793928a))

### Fixed

* Make exported videos react to the music like the preview ([568e95b](https://github.com/zivavu/OpenMosh/commit/568e95bf30f7707ba809903416c9d680662a31b0))
* Keep loud bass moving in Audio Bars and audio links ([01e2884](https://github.com/zivavu/OpenMosh/commit/01e288409285c3191acf49550eeecf32ca0e5be3))
* Keep the first project when the same file or song is uploaded again ([8d75f03](https://github.com/zivavu/OpenMosh/commit/8d75f034bbe5b37a07ca67499d4393f7c0a877fb))
* Save the editor's frame instead of a black image ([e4c80cd](https://github.com/zivavu/OpenMosh/commit/e4c80cdf9aac5e21944ae082b6cec2487faae871))
* Show notifications again ([4941f1e](https://github.com/zivavu/OpenMosh/commit/4941f1ee01eeb60051a1ea6b0f01215f9e3dd884))

## [0.9.10](https://github.com/zivavu/OpenMosh/compare/v0.9.9...v0.9.10) (2026-10-07)

This release reworks several effects ahead of 1.0. Glow, VHS, Insta Color, Bulge and Jitter look different, Slices has an Angle slider, and Polar is gone.

Older projects keep their settings, but some of them now look different. Glow's Cutoff runs the other way: a low value lights up less of the picture. Saved chains lose Polar. Kaleido mirrors the top half of the frame. VHS static comes and goes in bursts, Insta Color's filters keep their names with new grading, and Bulge is gentler at middle amounts. Slices set to Horizontal open at 0° and Vertical at 90°. Jitter's Speed slider now sets how fast it jitters.

### Added

* Give Glow a soft, colourful halo ([61d7a0e](https://github.com/zivavu/OpenMosh/commit/61d7a0ee437148c523044f2611549e826f5211ae))
* Make VHS static flicker in random bursts ([07bed17](https://github.com/zivavu/OpenMosh/commit/07bed17d238d51ebb94d683ea2acf1fdd1d4e148))
* Rebuild Insta Color's filters with smoother, cleaner grading ([33abb76](https://github.com/zivavu/OpenMosh/commit/33abb769dd1d27093386ee8133321aa4723d9125))
* Make Jitter fray the image in random, drifting patches ([d4ddd4b](https://github.com/zivavu/OpenMosh/commit/d4ddd4b23e4a5aa3a100208c13ceb895f4b3e041))
* Replace Slices' direction with an Angle slider ([a151de7](https://github.com/zivavu/OpenMosh/commit/a151de7525ce07fa354f8a169ac09144c239da40))
* Add Feather to Circle Warp ([89ddbef](https://github.com/zivavu/OpenMosh/commit/89ddbefa9c46bc65fc69c81f249066668e43b0cd))
* Add Position X and Y to 3D Transform ([24ddda3](https://github.com/zivavu/OpenMosh/commit/24ddda3525beaa13ca6c2983eb16c5f8740346cc))
* Remove the Polar effect ([c6b6183](https://github.com/zivavu/OpenMosh/commit/c6b6183c02a16430462cfd6629c5e1d7a99ec67a))

### Fixed

* Stop Bulge smearing into rays at high amounts ([38ab14d](https://github.com/zivavu/OpenMosh/commit/38ab14d8d340ae763f774fb0942fe361398f1941))
* Mirror Kaleido from the top half of the frame ([31a6931](https://github.com/zivavu/OpenMosh/commit/31a6931aa817082d2c1db11193a1e94454e1d730))

## [0.9.9](https://github.com/zivavu/OpenMosh/compare/v0.9.8...v0.9.9) (2026-10-06)

The new Mask effect limits effects to part of the picture. It started as a feature request ([#44](https://github.com/zivavu/OpenMosh/issues/44)). Edit Media's background key now matches colors the same way the Mask does.

A key saved in Edit Media keeps its colors and points, but its old Threshold, Brightness range and Smoothing settings go back to the new defaults, so it may need retuning.

### Added

* Limit the effects above a Mask to one area: an ellipse, a rectangle, a gradient, a brightness range, a brush painting, picked colors or a black-and-white image ([1636f73](https://github.com/zivavu/OpenMosh/commit/1636f73fa0ba1d7c98d5d23175b60d81f28f7865), [97ce107](https://github.com/zivavu/OpenMosh/commit/97ce10783ad3ba961fb46b897834cc2e6d6abcda), [bfb4f33](https://github.com/zivavu/OpenMosh/commit/bfb4f3318a96543bcff02375f62637ac8045ddee), [e14f2e9](https://github.com/zivavu/OpenMosh/commit/e14f2e9cd5101973dc97dc9898117435b168145f), [d8033c2](https://github.com/zivavu/OpenMosh/commit/d8033c2c2fa7a809ad167014f259fd48015446b1), [a9f3e36](https://github.com/zivavu/OpenMosh/commit/a9f3e36d1cd758adfa99778d3315cacee5c60af5), [61c1869](https://github.com/zivavu/OpenMosh/commit/61c18695ec648cd4258f76081267ee12f26443f9), [3ebe4e7](https://github.com/zivavu/OpenMosh/commit/3ebe4e750180e6df13727d8a1f564c9ae1679fbe), [dc0aa61](https://github.com/zivavu/OpenMosh/commit/dc0aa6115ae5db29ab5bd14fb42e98195e23b617))
* Move, resize and rotate Mask shapes and images on the preview ([f3bb1dd](https://github.com/zivavu/OpenMosh/commit/f3bb1ddaa4c7323d3a3b6e8ddc5ac8edbb4849d7), [ec95bda](https://github.com/zivavu/OpenMosh/commit/ec95bda8e1d018ca15e85d382063f225d082d898))
* Feather a Mask's brush painting after you paint it ([ef0e252](https://github.com/zivavu/OpenMosh/commit/ef0e2523c4c83379c1ffad63ec12a52c7fab5d35))
* Pick a Mask's colors on the preview, drag them around, and limit a color to the patch it was picked in ([60e35e6](https://github.com/zivavu/OpenMosh/commit/60e35e6ed750bc488cfaeac852f64f9179e06b91), [18de2d8](https://github.com/zivavu/OpenMosh/commit/18de2d8b86ae08a10de0249b19dbae7a6b801539), [a0d84a3](https://github.com/zivavu/OpenMosh/commit/a0d84a3af7888197e4823304cb4874c906c8312e), [bab32fa](https://github.com/zivavu/OpenMosh/commit/bab32fa1dd7d67323fd9287080737f757fa93807))
* See what each Mask color selects, and switch colors off ([163c2c7](https://github.com/zivavu/OpenMosh/commit/163c2c78feba0eea5af15bd9b69b6b9786c67ac2))
* See a Mask's area while you change it ([73734fb](https://github.com/zivavu/OpenMosh/commit/73734fb9769c73d5f67ddecb5756ce253efbecf7), [b79ed80](https://github.com/zivavu/OpenMosh/commit/b79ed80bb11e07558dfdfc7a924a1b0a61f4efad), [7e75852](https://github.com/zivavu/OpenMosh/commit/7e758523a0156d5a995c25b008afe29b5e023dc8))
* Key media in Edit Media by color like the Mask does: drag points on the preview, set their range, switch them off and preview one at a time ([cc02492](https://github.com/zivavu/OpenMosh/commit/cc0249252ff00998bc4b7eef28c74f4967f66129), [b0110b5](https://github.com/zivavu/OpenMosh/commit/b0110b5154019fc1113edb428eda807bfc4a9696), [736d203](https://github.com/zivavu/OpenMosh/commit/736d203934342654160c5270341af09791e7470a), [fb6de55](https://github.com/zivavu/OpenMosh/commit/fb6de553cf3eacb8f4d2e06d5225f19eca852519))
* Delete the selected key point with the Delete key ([3d9c586](https://github.com/zivavu/OpenMosh/commit/3d9c5863b77494551a094dff09d58f573ca7ff74))
* Turn off the selected layer's highlight in settings ([4cfd38f](https://github.com/zivavu/OpenMosh/commit/4cfd38f8df1973dd93dc362e696581900202eb9c))
* Hide the layer outline while editing a Mask ([756171d](https://github.com/zivavu/OpenMosh/commit/756171d3a6bd55599b97bccdfd6952ae89781acd))

### Fixed

* Keep the key's Whole frame and Connected buttons the same size ([5134583](https://github.com/zivavu/OpenMosh/commit/5134583a7904c5e2a30d4d752e61c4eed417a0ec))

## [0.9.8](https://github.com/zivavu/OpenMosh/compare/v0.9.7...v0.9.8) (2026-10-04)

OpenMosh now lives at [openmosh.com](https://openmosh.com/). Projects saved on open-mosh.vercel.app stay in your browser at that address, which keeps working: save them to files there, then open the files on the new site.

### Added

* Turn smaller previews of large videos off for every project, in the Mosh settings ([fdc1d39](https://github.com/zivavu/OpenMosh/commit/fdc1d39095b157a3d0b8d6b84a4442bd45ba41a0))
* Drag songs from the library onto audio lanes ([40f79f3](https://github.com/zivavu/OpenMosh/commit/40f79f38b0bfb94256f0d717aa89145aee0db3e1))
* Move and trim clips selected across lanes together ([ff0fe14](https://github.com/zivavu/OpenMosh/commit/ff0fe14cbe4fca310640949507822a076abc18cd))
* Set a video's speed from its media clip ([cb5c752](https://github.com/zivavu/OpenMosh/commit/cb5c752e396af684a86c731463883c487b5326ad))
* Rename and delete projects from the editor drawer ([0c9dfa7](https://github.com/zivavu/OpenMosh/commit/0c9dfa715484b9c1767e46b7e976b2f2a17aa65e))
* Step the resize width and height with the arrow keys ([587352c](https://github.com/zivavu/OpenMosh/commit/587352c66702966aa4bb39a316d189a4e4327b62))
* Explain why a 3D model can't be used ([b3d3c27](https://github.com/zivavu/OpenMosh/commit/b3d3c276bc09bffb3e35a040699a9b7462a39811))
* Show where a WebM export will play ([a95c963](https://github.com/zivavu/OpenMosh/commit/a95c963853ea446aa2ccb55f585d306d27160c06))
* Media layers are now called media lanes ([dac26a5](https://github.com/zivavu/OpenMosh/commit/dac26a5bd29d7e919823b8bac2053fbc8ce473da))
* Point visitors on the old address to openmosh.com ([b8025c3](https://github.com/zivavu/OpenMosh/commit/b8025c369403592d0bf9265380804fc8f1243b23))

### Fixed

* Switch to the smaller preview copy once it's ready ([272de06](https://github.com/zivavu/OpenMosh/commit/272de0615a52e0515d901d247ef57c92e58347f8))
* Turn a video's smaller copy on or off from the media rail ([f3452f0](https://github.com/zivavu/OpenMosh/commit/f3452f008bcf5882b6527ab46652c3e5e27fb653))
* Say so when the browser won't save your media ([8604e44](https://github.com/zivavu/OpenMosh/commit/8604e44ce42cf19a62c86905af7246d07a565081))
* Hold playback until the media has loaded ([cd26dea](https://github.com/zivavu/OpenMosh/commit/cd26deaa806353388b1c9fc9a669bafa8d2d1ce9))
* Open projects at their own aspect ratio ([4dce2e4](https://github.com/zivavu/OpenMosh/commit/4dce2e463b6e0508d0647851e7c59e80a3a18d2f))
* Line the export span up with the timeline ([8e5efb5](https://github.com/zivavu/OpenMosh/commit/8e5efb538748bff1d80afd5637f03ba262390524))
* Keep Spin Axis steady while Spin follows the music ([6953308](https://github.com/zivavu/OpenMosh/commit/695330899491da72aa67e4fad1f87a101d543ca8))
* Keep 3D models sharp on a wide perspective ([ac3372d](https://github.com/zivavu/OpenMosh/commit/ac3372df917a88b90496cbdb5cc8c58813b18071))
* Show the colours of vertex-coloured GLB models ([7dc11d1](https://github.com/zivavu/OpenMosh/commit/7dc11d1e6b74d8bcfe57a74a01b5f5bb135170e0))
* Scroll the effect list up and down while dragging an effect ([94cc7eb](https://github.com/zivavu/OpenMosh/commit/94cc7eb6c5328f33b0a5016b091cbab54f251c1d))
* Cut long clip names short in the clip bar ([5080170](https://github.com/zivavu/OpenMosh/commit/50801706223d6474a833bc67df9b862b363dc6c2))
* Show the selected media's whole outline in the rail ([40c6fd4](https://github.com/zivavu/OpenMosh/commit/40c6fd42bbb96bed515450a3df6c8035d9a75ed3))

### Faster

* Download fonts only when text needs them ([f726f28](https://github.com/zivavu/OpenMosh/commit/f726f28de1225ddb587b31c9456f2001e5740b1f))
* Keep many 3D models smooth in the editor ([e3a694c](https://github.com/zivavu/OpenMosh/commit/e3a694cec4f9dccfe378ec38c8ab3034b6c67a59))

## [0.9.7](https://github.com/zivavu/OpenMosh/compare/v0.9.6...v0.9.7) (2026-10-03)


### Added

* Report a crash straight from the error screen ([1f3546b](https://github.com/zivavu/OpenMosh/commit/1f3546b735dbac93285ea511ecf73a705a073423))
* Switch projects from the editor's side drawer ([a9127e8](https://github.com/zivavu/OpenMosh/commit/a9127e81ff46cfdb1de5f82bff513f590868d8e6))


### Fixed

* Ask what happened before sending a crash report ([2e4fe63](https://github.com/zivavu/OpenMosh/commit/2e4fe63f2cab5354b4fdb93a47e629336f1d073c))
* Delete only the edit picked in the recent list ([3a28a07](https://github.com/zivavu/OpenMosh/commit/3a28a0752798e0e7116529831c5238d5bc988702))
* Fit the editor's top bar on every screen size ([6c87eee](https://github.com/zivavu/OpenMosh/commit/6c87eee7ca0dc356874a53ed0c5cc51c7659fc9c))
* Give the project menu a solid background ([200b807](https://github.com/zivavu/OpenMosh/commit/200b807415fadbf520d727729bb34b48cae7fe91))
* Keep a crash report's text when the dialog closes ([6ebf5b9](https://github.com/zivavu/OpenMosh/commit/6ebf5b9b773a447d616949aa4471ccccd9d7e045))
* Keep a project's timeline however many other files get opened ([2d6ad2a](https://github.com/zivavu/OpenMosh/commit/2d6ad2a0115d8a92227ecd67c84fd088e41d1f22))
* Keep a song's file type in project files ([a42ea34](https://github.com/zivavu/OpenMosh/commit/a42ea34d2d8e71bb55dec207aa21b02439c1f88e))
* Keep an old project's song when it's saved to a file ([7e907f2](https://github.com/zivavu/OpenMosh/commit/7e907f2f74fbec197fe2bf303c5ef69ebb018b8d))
* Keep every saved project and edit, however many there are ([c0aa8aa](https://github.com/zivavu/OpenMosh/commit/c0aa8aa22292a0efbdf09f57a47e70c35c010a80))
* Keep saving on older Safari ([d16b8d6](https://github.com/zivavu/OpenMosh/commit/d16b8d650d5735db605583d43a8147472a4e2fa2))
* Keep the effect chain in a crash report ([552b9e8](https://github.com/zivavu/OpenMosh/commit/552b9e85275a70d3e3cbdd9b08a6a3e510314607))
* Make Cancel stop an export when the encoder hangs ([1e2d9b1](https://github.com/zivavu/OpenMosh/commit/1e2d9b1568adc097837a96b4c2632f3e2721c374))
* Make Load a file the main button on the upload screen ([8447094](https://github.com/zivavu/OpenMosh/commit/8447094261165e0d5cbfe1c9237656e4adaf77b0))
* Offer a project download only where there's one project ([16080af](https://github.com/zivavu/OpenMosh/commit/16080af007962e0fb3db5b4804f440ebf994e27e))
* Open damaged projects instead of failing halfway ([bd95829](https://github.com/zivavu/OpenMosh/commit/bd958294c4c6e61b1bfda15de0c195f581f071b2))
* Open the project drawer on the Projects tab every time ([ec66711](https://github.com/zivavu/OpenMosh/commit/ec66711d1fda64d5e470aeec12d1d9934cc39d05))
* Release media files once they've been read ([6e6b765](https://github.com/zivavu/OpenMosh/commit/6e6b765fbccf10cea1e796ee34723132b9814fd2))
* Save media added just before a project file ([31223aa](https://github.com/zivavu/OpenMosh/commit/31223aa6d0e255896d48ea63806132c5d735946c))
* Save the slideshow's last change on reload or Back ([fee2a6b](https://github.com/zivavu/OpenMosh/commit/fee2a6b51320f78b3ab9b0894a63dd278e77bf2c))
* Say so when a panel fails to load, and let it retry ([e72cb3f](https://github.com/zivavu/OpenMosh/commit/e72cb3fc70b7d05634e95920990ec50d695584e2))
* Show 3D models that have no animation ([75568c3](https://github.com/zivavu/OpenMosh/commit/75568c355480d6c8098ee1bfd92557be50949241))
* Show a failed save even when an earlier one succeeded ([104e0c7](https://github.com/zivavu/OpenMosh/commit/104e0c71cd6a04817a3b8f5e4d383484151863ff))
* Stop filling browser storage with per-file settings ([999925d](https://github.com/zivavu/OpenMosh/commit/999925d1485d885a36155a93fad576c932a40114))
* Stop project files from fetching fonts from any site ([3c58d24](https://github.com/zivavu/OpenMosh/commit/3c58d2444b9a1f8de9ac7d59003a788f542d055b))
* Stop repeating the error message in Chrome crash reports ([299ed7f](https://github.com/zivavu/OpenMosh/commit/299ed7f871637031c80ac94a9a03ecbfe9777643))
* Take a video edit's text with it when it's deleted ([1f03852](https://github.com/zivavu/OpenMosh/commit/1f03852d09b0f6cd9f433264930a5c09fc953b82))
* Turn the camera off if the editor closes while it reopens ([ccc7093](https://github.com/zivavu/OpenMosh/commit/ccc70939213f6026f055be88bf55ef2d09b4d245))
* Undo a layer move or a BPM change in one step ([0325bc5](https://github.com/zivavu/OpenMosh/commit/0325bc515175734d9555c039a75a064fe197294e))


### Faster

* Clean up storage at most once a minute ([3e7f936](https://github.com/zivavu/OpenMosh/commit/3e7f936e36e7a9e71d93875ad1a0aec69684654f))
* Stop keeping every decoded song in memory ([e40725c](https://github.com/zivavu/OpenMosh/commit/e40725cc12346c7491059f3970eeca01511bbab2))
* Use less memory for undo history ([a13ce98](https://github.com/zivavu/OpenMosh/commit/a13ce981fe73b5ccadf95971cbb7d6e68a5d399a))
* Write exports to disk as they render, not to memory ([4e3ffd9](https://github.com/zivavu/OpenMosh/commit/4e3ffd924d993cb943505654f8d31271cee34767))

## [0.9.6](https://github.com/zivavu/OpenMosh/compare/v0.9.5...v0.9.6) (2026-09-30)


### Added

* Change a model's animation speed ([da085ce](https://github.com/zivavu/OpenMosh/commit/da085ce7dda0c7800eaad9d7247d34b6676f1885))
* Download saved projects from the upload screen ([bc7284b](https://github.com/zivavu/OpenMosh/commit/bc7284bbccc6cf4deb293cfbdbf075c0c7ad0466))
* Fit a 3D model's layer box to the model ([4bebb4b](https://github.com/zivavu/OpenMosh/commit/4bebb4bb43480d30b7942eff08053b5cd7dc3e22))
* Give Edges thickness, passthru and a line colour ([1b839ac](https://github.com/zivavu/OpenMosh/commit/1b839acb2981529f9fa00d3071dbc33f2f9c77e2))
* Keep working offline after the first visit ([f33a9d0](https://github.com/zivavu/OpenMosh/commit/f33a9d081853340034fd56ed0658d32191a81b5c))
* List live effects first in the effects panel ([9fdf203](https://github.com/zivavu/OpenMosh/commit/9fdf203a3856013fc44ae4c481f901f60445bf18))
* Make Halftone a crisp colour dot screen ([2a698fe](https://github.com/zivavu/OpenMosh/commit/2a698fe826bf6c7193e1ec9d08573afcfd4922c4))
* Open the matching issue form from the feedback dialog ([a6d4b34](https://github.com/zivavu/OpenMosh/commit/a6d4b343aaef43a8541068d781bb1997b4d368c3))
* Pick where a model's animation starts ([e952bcb](https://github.com/zivavu/OpenMosh/commit/e952bcb7f58d67b3b5b5aec53a62ff170b7aedd5))
* Play animated GLB and FBX models ([7bf75ac](https://github.com/zivavu/OpenMosh/commit/7bf75acb083bf29a34d876b09ac47427623e015b))
* Remove media straight from its preview ([519b37d](https://github.com/zivavu/OpenMosh/commit/519b37de80029a2efd2d5e26ac3aafa526c79d25))
* Save and open Editor projects as files ([a3bc491](https://github.com/zivavu/OpenMosh/commit/a3bc4919e9b09c455701d82887d8d56aefb7e147))
* Share presets as files ([9c9028e](https://github.com/zivavu/OpenMosh/commit/9c9028e6ce8e47b81cff659a8f5cfcefaaf642d5))
* Show a lighter 2D demo on slower devices ([aa46b12](https://github.com/zivavu/OpenMosh/commit/aa46b126691f1ea34fe9bbb1c43086953692fecd))
* Show a preview when an OpenMosh link is shared ([7d57578](https://github.com/zivavu/OpenMosh/commit/7d57578e9efea8f53d53ebd8756fabfcd204b61d))
* Try the app on a sample image with one click ([fd41703](https://github.com/zivavu/OpenMosh/commit/fd41703d0b209af015080f23fed72808550e1465))
* Warn up front when a browser can't export ([eedafd8](https://github.com/zivavu/OpenMosh/commit/eedafd824a63248d4a938bebb3b3e98bfeccc829))


### Fixed

* Change 3D Transform's spin speed without a jump ([4696fa8](https://github.com/zivavu/OpenMosh/commit/4696fa801c0c1bcdbc2e1025bbe908a95b188567))
* Detect a song's exact BPM so cuts stay on the beat ([fbe9953](https://github.com/zivavu/OpenMosh/commit/fbe9953c63c7c826f01cbf6437bcdc3a60bf3ce7))
* Hide the edit button when previewing a 3D model ([b696c31](https://github.com/zivavu/OpenMosh/commit/b696c3164013e17c9655415fa42135eec885fca3))
* Keep a mosh's live effects at the top of the list ([078344f](https://github.com/zivavu/OpenMosh/commit/078344f20751c0c0c6a4343bf1fd71f5a15f693b))
* Let random moshes and locks reach every effect ([4fdd807](https://github.com/zivavu/OpenMosh/commit/4fdd80717039c58f6293e66af67eea33810443ec))
* Make RGB Burst fire bursts instead of shaking the frame ([274ac65](https://github.com/zivavu/OpenMosh/commit/274ac6518a7cb5930c221170a0a2803555bc27eb))
* Split sped-up or trimmed videos where they were ([57445cb](https://github.com/zivavu/OpenMosh/commit/57445cbb7a6400634245611aad57fd28439b0bf5))
* Stop the upload screen clipping on short viewports ([038b2b4](https://github.com/zivavu/OpenMosh/commit/038b2b4be4ae6c4ae020630d13e439e938596394))

## [0.9.5](https://github.com/zivavu/OpenMosh/compare/v0.9.4...v0.9.5) (2026-09-29)


### Added

* Add Insta Color, 29 photo-app colour grades ([6a0490a](https://github.com/zivavu/OpenMosh/commit/6a0490aa0343b323691956884f78bfce7d4ad8f8))
* Always loop slideshow images ([63a44f2](https://github.com/zivavu/OpenMosh/commit/63a44f2e2a2ed070e34bb3e757b1d3265aa0e767))
* Give every moshed 3D model a 3D Transform ([f74c135](https://github.com/zivavu/OpenMosh/commit/f74c13578389a209fb153d51a00fd198efc9a996))
* Load OBJ and STL 3D models in the editor ([f593f34](https://github.com/zivavu/OpenMosh/commit/f593f347a87824edefdddae747c607a6789b5ea0))
* Remove the slideshow's per-image preset mode ([8ab6b10](https://github.com/zivavu/OpenMosh/commit/8ab6b108cdd46a599f8be8000ea2f99879ad2bc3))
* Show eight moshed 3D worlds behind the upload screen ([8208cbd](https://github.com/zivavu/OpenMosh/commit/8208cbdeed39466583a6b35d8d145a737d89bf70))
* Start slideshows with a beat line already drawn ([177f50c](https://github.com/zivavu/OpenMosh/commit/177f50cce2ebea7816983e6772a52c4a95116e3f))
* Turn 3D models in depth with the 3D Transform effect ([5f07af2](https://github.com/zivavu/OpenMosh/commit/5f07af2d98aba50c57b1cd213d82132bfa2c7964))


### Fixed

* Stop the slideshow preview sticking on one image ([94821b5](https://github.com/zivavu/OpenMosh/commit/94821b554b4f884aa9930793c8ae8fa9c6991989))

## [0.9.4](https://github.com/zivavu/OpenMosh/compare/v0.9.3...v0.9.4) (2026-09-28)


### Added

* Drag the repeated stretch to move or resize it ([074864b](https://github.com/zivavu/OpenMosh/commit/074864b6b42f61045181bd5cd51042f18f836c36))
* Drop media onto every selected clip at once ([74fc061](https://github.com/zivavu/OpenMosh/commit/74fc0611e0175a3cdd2e5eb59c4b823d641e4c24))
* Edit the effects of several selected clips at once ([6db54c5](https://github.com/zivavu/OpenMosh/commit/6db54c5d5285517cfff786ef7b0dc53883a594e7))
* Give the key's sliders more room at the low end ([5129dae](https://github.com/zivavu/OpenMosh/commit/5129dae4478b67c42acfd95f781a666581e54780))
* Hide the layer highlight after the first mosh ([37172a7](https://github.com/zivavu/OpenMosh/commit/37172a7d13b1d8d2bae4e3dd684a24a08dfc55d9))
* Key several colours, frame-wide or only where they touch ([a5c4c1a](https://github.com/zivavu/OpenMosh/commit/a5c4c1a2e5a83db9fb6d35111fb9f1621c2fbe73))
* Let Tile overlap its copies into mirrored patterns ([a4a73c8](https://github.com/zivavu/OpenMosh/commit/a4a73c8350390c7581337254e73d78d427118f20))
* Loop short videos to 20 seconds when dropped on a lane ([0329db6](https://github.com/zivavu/OpenMosh/commit/0329db68fdb356376186201133c1629d23675f28))
* Make Curated the default mosh style ([1686667](https://github.com/zivavu/OpenMosh/commit/168666760f2b76f97a1c20579b9b5d82ff69a934))
* Make Smear sharp, with Trail as optional ghosting ([5064465](https://github.com/zivavu/OpenMosh/commit/506446567457928faf3171769f51f251834be093))
* Preview Ctrl+click clips and size them like drops ([5855b46](https://github.com/zivavu/OpenMosh/commit/5855b4630d110717dbeff49384b94bdd0602aea4))
* Rebuild Vignette with feather, roundness and color ([e20ac63](https://github.com/zivavu/OpenMosh/commit/e20ac6323036e26a97a26db0654be174419c11b9))
* Remove the Under effects switch from layers ([9811365](https://github.com/zivavu/OpenMosh/commit/981136540ca68cb8a09a6d888aeecfd02f8b6afb))
* Rotate media layers from a handle on the canvas ([27fb509](https://github.com/zivavu/OpenMosh/commit/27fb509966a56d51668a3d9a1f7e7db39dcc9f77))
* Show loading cards in the media grid while files load ([2233c65](https://github.com/zivavu/OpenMosh/commit/2233c65070b502f7c4c7a8aa4162063f8f89935f))
* Show that Alt turns snapping off while dragging ([0619972](https://github.com/zivavu/OpenMosh/commit/0619972568d7da233550342c27a327a32e11dc96))
* Show when the Mosh settings are the editor's own ([5715479](https://github.com/zivavu/OpenMosh/commit/57154791313ce442b571b485d644fee73e9c47d5))


### Fixed

* Keep an edit made just before a reload ([d959994](https://github.com/zivavu/OpenMosh/commit/d959994ef81e4c7d05daa00684ac91bbe325c033))
* Keep Tracking boxes on their targets ([2ac1178](https://github.com/zivavu/OpenMosh/commit/2ac1178b1cdcdc47e2a768cff521ae03669b2772))
* Move audio-linked sliders in the clip effects panel again ([ec216b1](https://github.com/zivavu/OpenMosh/commit/ec216b1c9f2b6fbccd5d6c2565b45670bb09b232))
* Show the media editor's key exactly as it renders ([ffc63af](https://github.com/zivavu/OpenMosh/commit/ffc63afd6998011bb335eb7735be9c05e192ef85))
* Stop RGB slip and shatter jumping at their ends ([1a8bdbb](https://github.com/zivavu/OpenMosh/commit/1a8bdbb2cae656df89b8a460b3df3cc807f647d4))

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
