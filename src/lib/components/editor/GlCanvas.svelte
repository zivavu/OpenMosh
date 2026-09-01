<script lang="ts">
   import { Minimize } from "lucide-svelte";
   import type { Snippet } from "svelte";
   import type { EffectInstance } from "../../effects";
   import { ANIMATED_EFFECTS } from "../../gl/effect-shaders";
   import { fitPreviewSize, measureDisplaySize } from "../../gl/preview-size";
   import {
      GlRenderer,
      type PostChainLayer,
      type SourceFit,
   } from "../../gl/renderer";
   import { untrack } from "svelte";
   import {
      layerHitBoxes,
      pickTopLayer,
      type LayerPick,
   } from "../../editor/layer-pick";
   import { onFontsChanged } from "../../text-overlay";
   import {
      resolveTextLayersAt,
      type ResolvedTextLayer,
      type TextTimeline,
   } from "../../text";
   import {
      resolveMediaLayersAt,
      type MediaLane,
      type MediaTimeline,
      type ResolvedMediaLayer,
      type SourceEdit,
   } from "../../media";
   import type { VideoPreviewPlayer } from "../../video-preview/preview-player.svelte";
   import { decodeStats } from "../../video/decode";

   /** Active sequence transition descriptor. Progress is computed per rendered
    * frame from `getTime()` so the blend stays smooth even when the editor's
    * reactive clock ticks slower than the rAF loop. */
   export interface CanvasTransition {
      effectsA: EffectInstance[];
      type: string;
      seed: number;
      direction: number;
      density: number;
      /** Master-clock time where the blend starts. */
      startTime: number;
      durationSec: number;
      getTime: () => number;
      /** Chain A draws from the outgoing source texture — set when the two
       * segments use different media, so the media cross-fades too. */
      useAltSource?: boolean;
   }

   /** Shared, so the default prop doesn't mint an array per render. */
   const EMPTY_POST: PostChainLayer[] = [];
   const EMPTY_MEDIA: ResolvedMediaLayer[] = [];
   const EMPTY_SOURCE_EDITS: Record<string, SourceEdit> = {};
   const EMPTY_SOURCE_DURATIONS: Record<string, number> = {};

   interface Props {
      imageSrc: string;
      effects: EffectInstance[];
      canvasWidth?: number;
      canvasHeight?: number;
      canvasEl?: HTMLCanvasElement | null;
      glRenderer?: GlRenderer | null;
      naturalWidth?: number;
      naturalHeight?: number;
      fps?: number;
      showFps?: boolean;
      videoEl?: HTMLVideoElement | null;
      /** WebCodecs preview player; takes precedence over videoEl as frame source. */
      frameSource?: VideoPreviewPlayer | null;
      freezeAnimation?: boolean;
      /** Stops all preview rendering (e.g. while recording, when the recorder
       * owns the shared renderer — interleaved renders corrupt per-effect
       * feedback history and delta-time state). */
      suspended?: boolean;
      /** True when a parent component drives `renderer.render()` itself (e.g. the
       * slideshow preview engine). Prevents this component's rAF and static
       * redraw effects from rendering duplicate frames. */
      externallyDriven?: boolean;
      warmCanvas?: HTMLCanvasElement | null;
      warmRenderer?: GlRenderer | null;
      /** Sequence segment transition in progress; `effects` is the incoming chain. */
      transition?: CanvasTransition | null;
      /**
       * Sequence fx lanes: stacked over whatever the source lane produced, so
       * during a transition they run over the finished blend rather than on
       * each side of it, and so a fading lane can mix against its own input.
       * `effects` still carries their instances flat, for the animation check
       * and the audio-link tick — the renderer is handed the layers.
       */
      postLayers?: PostChainLayer[];
      /** Sequence multi-source: uploads the active segment's frame for wherever
       * the master clock is (the driver reads it — this loop's wall-clock time
       * would make the same song position show different frames). Returning
       * true means it owned the source texture, so the primary image/video
       * upload is skipped. */
      sourceDriver?: (() => boolean) | null;
      /** Uploads the outgoing segment's frame during a transition. Returning
       * false means the primary's frame is the outgoing one, so this component
       * has to route it to the alt texture itself. */
      outgoingDriver?: (() => boolean) | null;
      /** Changes whenever the driven source does, retriggering a paused redraw. */
      sourceKey?: string | null;
      /** True while the driven source needs a per-frame upload (a video). */
      sourceAnimating?: boolean;
      /** Two-way: set it to enter/leave fullscreen, and it follows Esc or any
       * other way the browser drops out of it. */
      fullscreen?: boolean;
      /** How a source that doesn't match the output aspect is fitted into it. */
      sourceFit?: SourceFit;
      /** Per-source edits, keyed by source id. Sparse: only edited media. */
      sourceEdits?: Record<string, SourceEdit>;
      /** How long each source's media runs, so a keyed edit is sampled at the
       * instant the frame sampler wrapped to. Sparse; images may be omitted. */
      sourceDurations?: Record<string, number>;
      /** Which pool source the frame comes from, so its own edits can be found.
       * Null for media with no pool entry, which carries none. */
      sourceEditId?: string | null;
      /** The same for the outgoing side of a transition. */
      outgoingEditId?: string | null;
      /** Seconds into that source's own media, for sampling a keyed edit. The
       * clip's own clock, not the master's: an edit belongs to the file, so the
       * same instant of it is edited the same way wherever it plays. */
      sourceEditTime?: number;
      outgoingEditTime?: number;
      /** Optional text lanes composited into the chain at their insertion points. */
      textTimeline?: TextTimeline | null;
      /** Optional media lanes, composited the same way. */
      mediaTimeline?: MediaTimeline | null;
      /** Lane whose clip is selected: gets an outline over the preview, so the
       * placement sliders say which part of the frame they are moving. */
      selectedMediaLane?: MediaLane | null;
      /** Lane being soloed: it is drawn by itself on black, with the source, the
       * effects and every other layer left out. Preview only — an inspection
       * mode, never a property of the work. */
      soloMediaLaneId?: string | null;
      /** Uploads each visible media layer's frame before the chain runs. Called
       * with the layers resolved for this frame, on the master clock. */
      mediaDriver?: ((layers: ResolvedMediaLayer[]) => void) | null;
      /** Master-timeline seconds the text clips are looked up at. */
      textTime?: number;
      /** Song tempo, for beat-synced effects. 0 = unknown, they run free.
       * The grid is anchored to the same master clock `textTime` reads. */
      bpm?: number;
      /** Keep the animation loop running even when nothing else needs it — a
       * still image with a playing text timeline has no other reason to. */
      forceAnimation?: boolean;
      /** Drawn over the whole preview box — for states where the canvas holds
       * nothing worth looking at, like a sequence with an empty media pool. */
      overlay?: Snippet;
      /** Clicking the preview picks the layer drawn on top at that point, or
       * the base image when the click lands past every layer. Null means the
       * click found nothing at all — off the frame, or on a soloed lane's
       * blanked background. Absent means the preview isn't a way of selecting
       * anything. */
      onPickLayer?: ((pick: LayerPick | null) => void) | null;
      /** Live FFT bins for the audio-bars effect. The AnalyserNode mutates one
       * array in place, so this is read fresh every rendered frame rather than
       * reacted to. */
      spectrum?: Uint8Array | null;
   }

   let {
      imageSrc,
      effects,
      canvasWidth = undefined,
      canvasHeight = undefined,
      canvasEl = $bindable(null),
      glRenderer = $bindable(null),
      naturalWidth = $bindable(undefined),
      naturalHeight = $bindable(undefined),
      fps = $bindable(0),
      showFps = false,
      videoEl = null,
      frameSource = null,
      freezeAnimation = false,
      suspended = false,
      externallyDriven = false,
      warmCanvas = null,
      warmRenderer = null,
      transition = null,
      postLayers = EMPTY_POST,
      sourceDriver = null,
      outgoingDriver = null,
      sourceKey = null,
      sourceAnimating = false,
      spectrum = null,
      sourceFit = "contain",
      sourceEdits = EMPTY_SOURCE_EDITS,
      sourceDurations = EMPTY_SOURCE_DURATIONS,
      sourceEditId = null,
      outgoingEditId = null,
      sourceEditTime = 0,
      outgoingEditTime = 0,
      fullscreen = $bindable(false),
      textTimeline = null,
      mediaTimeline = null,
      selectedMediaLane = null,
      soloMediaLaneId = null,
      mediaDriver = null,
      textTime = 0,
      bpm = 0,
      forceAnimation = false,
      overlay = undefined,
      onPickLayer = null,
   }: Props = $props();

   let frameTimes: number[] = [];
   let lastFpsUpdate = 0;
   // Where a frame's time went. `src` and `gl` only cover the work this loop
   // issues; GL calls return once the commands are queued, so anything the GPU
   // or the compositor spends lands in `wait` instead — which is the whole
   // point of showing it. `up` is measured inside the renderer, because a
   // sequence lane uploads from a promise callback this loop can't wrap.
   let sourceMs = $state(0);
   let drawMs = $state(0);
   let uploadMs = $state(0);
   let waitMs = $state(0);
   /** Frames every decoder produced per second, however few the loop drew. */
   let decodeFps = $state(0);
   let sourceTotal = 0;
   let drawTotal = 0;
   let waitTotal = 0;
   let sampled = 0;
   let lastLoopEnd = 0;
   let lastDecoded = 0;

   /** Only called while the overlay is on: with it hidden, the sampling and its
    * `fps` write were reactive churn nobody could see. */
   function trackFps(now: number, sourceDone: number) {
      frameTimes.push(now);
      sourceTotal += sourceDone - now;
      drawTotal += performance.now() - sourceDone;
      if (lastLoopEnd > 0) waitTotal += now - lastLoopEnd;
      sampled++;
      if (now - lastFpsUpdate >= 400) {
         const elapsed = (now - lastFpsUpdate) / 1000;
         lastFpsUpdate = now;
         frameTimes = frameTimes.filter((t) => t > now - 1000);
         fps = frameTimes.length;
         sourceMs = sourceTotal / sampled;
         drawMs = drawTotal / sampled;
         waitMs = waitTotal / sampled;
         uploadMs = renderer ? renderer.uploadMs / sampled : 0;
         if (renderer) renderer.uploadMs = 0;
         sourceTotal = 0;
         drawTotal = 0;
         waitTotal = 0;
         sampled = 0;
         // The first window starts from a counter that has been running since
         // the file was opened, so it would read as the whole backlog at once.
         if (elapsed > 0 && elapsed < 5) {
            decodeFps = Math.round((decodeStats.frames - lastDecoded) / elapsed);
         }
         lastDecoded = decodeStats.frames;
      }
      lastLoopEnd = performance.now();
   }

   let previewArea = $state<HTMLDivElement>(null!);
   let canvas = $state<HTMLCanvasElement>(null!);
   let renderer: GlRenderer | null = $state(null);

   // ── Selected-layer outline ───────────────────────────────────────────────
   // DOM rather than a GL pass: this is an editing aid, and anything drawn into
   // the canvas would be in the export too. Sized from the renderer's own
   // `layerBox`, so it can't drift from where the media actually lands.
   let outline = $state<{
      left: number;
      top: number;
      w: number;
      h: number;
      rot: number;
   } | null>(null);

   /**
    * Where the rendered frame sits in client space and what it was scaled by:
    * an output pixel lands at `left + x * s`. Both the outline and the layer
    * picking go through here, so a click can't land somewhere the outline says
    * it didn't.
    *
    * Fullscreen letterboxes the frame inside the element (object-fit:
    * contain); outside it the element is already the content box, where both
    * ratios are equal and this reduces to the one scale.
    */
   function frameFit(): { left: number; top: number; s: number } | null {
      const cv = canvasEl;
      if (!cv || cv.width <= 0 || cv.height <= 0) return null;
      const cr = cv.getBoundingClientRect();
      const s = Math.min(cr.width / cv.width, cr.height / cv.height);
      if (!Number.isFinite(s) || s <= 0) return null;
      return {
         left: cr.left + (cr.width - cv.width * s) / 2,
         top: cr.top + (cr.height - cv.height * s) / 2,
         s,
      };
   }

   function updateOutline() {
      const lane = selectedMediaLane;
      const rect =
         lane && renderer ? renderer.mediaLayerRect(lane.id, lane.style) : null;
      const fit = rect ? frameFit() : null;
      if (!rect || !fit || !previewArea) {
         if (outline) outline = null;
         return;
      }
      const ar = previewArea.getBoundingClientRect();
      const next = {
         left: fit.left - ar.left + rect.x * fit.s,
         top: fit.top - ar.top + rect.y * fit.s,
         w: rect.w * fit.s,
         h: rect.h * fit.s,
         rot: rect.rot,
      };
      // Compared before assigning: this runs on every drawn frame, and a fresh
      // object each time would re-render the outline sixty times a second.
      if (
         outline &&
         Math.abs(outline.left - next.left) < 0.5 &&
         Math.abs(outline.top - next.top) < 0.5 &&
         Math.abs(outline.w - next.w) < 0.5 &&
         Math.abs(outline.h - next.h) < 0.5 &&
         outline.rot === next.rot
      ) {
         return;
      }
      outline = next;
   }

   // Selecting a lane, or editing its placement, need not redraw anything —
   // and a resize changes where the frame sits without redrawing at all.
   $effect(() => {
      const st = selectedMediaLane?.style;
      void [
         selectedMediaLane?.id,
         st?.x,
         st?.y,
         st?.scale,
         st?.rotation,
         st?.fit,
         canvasWidth,
         canvasHeight,
         fullscreen,
      ];
      // Untracked: the comparison inside reads `outline`, and a tracked read of
      // what this writes would re-enter the effect on every update.
      untrack(updateOutline);
   });

   $effect(() => {
      const area = previewArea;
      if (!area) return;
      const ro = new ResizeObserver(() => updateOutline());
      ro.observe(area);
      return () => ro.disconnect();
   });

   // ── Click to select a layer ──────────────────────────────────────────────
   // Written by the draw loop, read only when a click arrives: the layers this
   // frame put on screen, which is the only honest answer to what was clicked.
   let pickable: { media: ResolvedMediaLayer[]; text: ResolvedTextLayer[] } = {
      media: EMPTY_MEDIA,
      text: [],
   };

   /** Hand the layer under the pointer to the editor. Pointerdown rather than
    * click, matching the timeline lanes, and left button only — the canvas has
    * no menu of its own to compete with. */
   function pickLayerAt(e: PointerEvent) {
      if (!onPickLayer || e.button !== 0) return;
      // Anything else in the preview box is its own control, and the overlay
      // covers a canvas whose contents are stale by the time it is up.
      if (!renderer || !canvasEl || e.target !== canvasEl) return;
      const fit = frameFit();
      if (!fit) return;
      const x = (e.clientX - fit.left) / fit.s;
      const y = (e.clientY - fit.top) / fit.s;
      // Fullscreen letterboxes the frame inside the element, so a click can
      // land on the canvas and still be off the picture.
      if (x < 0 || y < 0 || x >= canvasEl.width || y >= canvasEl.height) {
         onPickLayer(null);
         return;
      }
      const hit = pickTopLayer(
         layerHitBoxes(
            pickable.media,
            pickable.text,
            canvasEl.width,
            canvasEl.height,
            (layer) => renderer!.mediaLayerRect(layer.key, layer.style),
         ),
         x,
         y,
      );
      if (hit) {
         onPickLayer({ kind: hit.kind, laneId: hit.laneId });
         return;
      }
      // Past every layer is the image they sit over — except under solo, where
      // the source is blanked and that is bare black, belonging to nothing.
      onPickLayer(soloMediaLaneId ? null : { kind: "base" });
   }
   let imageReady = $state(false);
   let error: string | null = $state(null);

   // Displayed preview size in device pixels. The renderer runs at the output
   // aspect fitted into this box (never upscaled), so heavy chains aren't paid
   // at full source resolution while the canvas is CSS-scaled down anyway.
   // Export/save temporarily resize the renderer to the real output size.
   let displayW = $state(0);
   let displayH = $state(0);
   $effect(() => {
      const el = previewArea;
      if (!el) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const measure = () => {
         const { width, height } = measureDisplaySize(el);
         displayW = width;
         displayH = height;
      };
      measure();
      // Debounced: each renderer resize reallocates every FBO, so tracking a
      // window drag-resize per event would thrash GPU memory.
      const ro = new ResizeObserver(() => {
         clearTimeout(timer);
         timer = setTimeout(measure, 150);
      });
      ro.observe(el);
      return () => {
         clearTimeout(timer);
         ro.disconnect();
      };
   });

   const renderSize = $derived(
      fitPreviewSize(canvasWidth, canvasHeight, displayW, displayH),
   );

   // ── Fullscreen ───────────────────────────────────────────────────────────
   // The preview area is the element that goes fullscreen, so the existing
   // ResizeObserver above picks up the new box and the renderer follows —
   // `fitPreviewSize` still caps at the output resolution, so a small source
   // isn't suddenly rendered at monitor size.
   $effect(() => {
      const el = previewArea;
      if (!el) return;
      const onChange = () => {
         fullscreen = document.fullscreenElement === el;
      };
      document.addEventListener("fullscreenchange", onChange);
      return () => document.removeEventListener("fullscreenchange", onChange);
   });

   $effect(() => {
      const el = previewArea;
      if (!el) return;
      const isFs = document.fullscreenElement === el;
      if (fullscreen === isFs) return;
      if (fullscreen) {
         // iOS Safari has no element fullscreen at all, and a request that
         // wasn't user-initiated is rejected. Either way, snap the flag back
         // so the button never sits in a state the document isn't in.
         const req = el.requestFullscreen?.();
         if (req) req.catch(() => (fullscreen = false));
         else fullscreen = false;
      } else if (document.fullscreenElement === el) {
         void document.exitFullscreen?.();
      }
   });

   // The exit hint fades on its own; re-shown on each entry.
   let showFsHint = $state(false);
   $effect(() => {
      if (!fullscreen) {
         showFsHint = false;
         return;
      }
      showFsHint = true;
      const timer = setTimeout(() => (showFsHint = false), 2200);
      return () => clearTimeout(timer);
   });

   const videoPlaying = $derived(!!videoEl && !videoEl.paused);
   const hasAnimatedEffects = $derived(
      effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
   );
   /** A media lane's own chain can animate with nothing else on screen moving. */
   const hasAnimatedLayers = $derived(
      !!mediaTimeline?.enabled &&
         mediaTimeline.lanes.some(
            (l) =>
               l.enabled &&
               l.effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
         ),
   );
   const needsAnimation = $derived(
      !externallyDriven &&
         !freezeAnimation &&
         (!!frameSource ||
            !!transition ||
            videoPlaying ||
            sourceAnimating ||
            forceAnimation ||
            hasAnimatedLayers ||
            hasAnimatedEffects),
   );

   /** Render the current frame: transition blend when a segment boundary is
    * being crossed, otherwise the plain effect chain. */
   function drawFrame(now: number) {
      // Before anything renders: the bars have to see this frame's audio, and
      // the export driver does the same on its side.
      renderer!.setSpectrum(spectrum, now);
      // Which media the two source textures hold, so the chain can apply that
      // source's crop, erase mask and key before reading it.
      renderer!.setSourceIds(
         sourceEditId,
         outgoingEditId,
         sourceEditTime,
         outgoingEditTime,
      );
      renderer!.setBeat(bpm > 0 ? (textTime * bpm) / 60 : null, bpm / 60);
      const solo = soloMediaLaneId;
      const layers =
         textTimeline && !solo ? resolveTextLayersAt(textTimeline, textTime) : [];
      const media = mediaTimeline
         ? resolveMediaLayersAt(mediaTimeline, textTime)
         : EMPTY_MEDIA;
      // Every lane is still driven, not just the soloed one: the driver drops
      // the frames of lanes it isn't asked about, and leaving solo would then
      // stall on re-uploading them.
      if (media.length > 0) mediaDriver?.(media);
      const shown = solo ? media.filter((l) => l.laneId === solo) : media;
      // What a click can land on is what the frame actually drew, so a soloed
      // lane's hidden neighbours can't be picked out of the black.
      pickable = { media: shown, text: layers };
      renderer!.setBlankSource(!!solo);
      const tr = solo ? null : transition;
      if (tr && tr.durationSec > 0) {
         const p = (tr.getTime() - tr.startTime) / tr.durationSec;
         if (p >= 0 && p < 1) {
            // `effects` already ends with the stacked lanes' instances; the
            // incoming chain is what's left once that tail is peeled off, since
            // the lanes run over the blend rather than inside either side.
            const stacked = postLayers.reduce((n, l) => n + l.effects.length, 0);
            const incoming =
               stacked > 0 ? effects.slice(0, effects.length - stacked) : effects;
            renderer!.renderTransition(
               tr.effectsA,
               incoming,
               tr.type,
               p,
               tr.seed,
               tr.direction,
               tr.density,
               now,
               tr.useAltSource ?? false,
               layers,
               postLayers,
               media,
            );
            return;
         }
      }
      // The plain path hands over the source chain alone plus the layers, so a
      // fading lane can be mixed against its input; `effects` is the flat form,
      // which would double the stacked instances if passed whole.
      const stacked = postLayers.reduce((n, l) => n + l.effects.length, 0);
      const base = stacked > 0 ? effects.slice(0, effects.length - stacked) : effects;
      // Solo drops the image chain and the fx lanes along with the source: what
      // is left is the lane's own media and its own effects.
      renderer!.render(
         solo ? [] : base,
         now,
         layers,
         solo ? [] : postLayers,
         shown,
      );
      // Every draw path ends here, so the outline follows a texture arriving,
      // the playhead moving off the clip, and an output-size change alike.
      updateOutline();
   }

   $effect(() => {
      try {
         let r: GlRenderer;
         let activeCanvas: HTMLCanvasElement;

         if (warmCanvas && warmRenderer) {
            // Move the pre-warmed canvas (currently hidden in <body>) into our
            // preview area. Styled by class, not inline: an inline rule would
            // outrank the :fullscreen overrides below.
            warmCanvas.style.cssText = "";
            warmCanvas.className = "preview-canvas";
            previewArea.appendChild(warmCanvas);
            warmRenderer.adoptCanvas(warmCanvas);
            r = warmRenderer;
            activeCanvas = warmCanvas;
         } else {
            r = new GlRenderer(canvas);
            activeCanvas = canvas;
         }

         renderer = r;
         canvasEl = activeCanvas;
         glRenderer = r;

         // Mutable ref so cleanup always destroys whichever renderer is currently
         // live, even if it was rebuilt by onContextRestored below.
         const current = { renderer: r };

         const onContextLost = (ev: Event) => {
            // preventDefault() is required for the browser to attempt automatic
            // restoration; without it, webglcontextrestored never fires.
            ev.preventDefault();
            error =
               "Lost the WebGL context. Trying to recover. If this keeps happening, reload the page.";
         };
         const onContextRestored = () => {
            const newRenderer = new GlRenderer(activeCanvas);
            current.renderer = newRenderer;
            renderer = newRenderer;
            canvasEl = activeCanvas;
            glRenderer = newRenderer;
            error = null;
         };
         activeCanvas.addEventListener("webglcontextlost", onContextLost);
         activeCanvas.addEventListener(
            "webglcontextrestored",
            onContextRestored,
         );

         return () => {
            activeCanvas.removeEventListener("webglcontextlost", onContextLost);
            activeCanvas.removeEventListener(
               "webglcontextrestored",
               onContextRestored,
            );
            current.renderer.destroy();
            renderer = null;
            canvasEl = null;
            glRenderer = null;
            if (warmCanvas && warmCanvas.parentNode === previewArea) {
               previewArea.removeChild(warmCanvas);
            }
         };
      } catch (e) {
         error = e instanceof Error ? e.message : "Failed to initialize WebGL2";
      }
   });

   // Image loading — skipped when a video source is active
   $effect(() => {
      if (!renderer || videoEl || frameSource) return;
      imageReady = false;
      const img = new Image();
      let cancelled = false;
      img.onload = () => {
         if (cancelled) return;
         renderer!.loadImage(img);
         naturalWidth = img.naturalWidth;
         naturalHeight = img.naturalHeight;
         // The main resize/draw effect below applies the preview render size
         imageReady = true;
      };
      img.src = imageSrc;
      return () => {
         cancelled = true;
      };
   });

   // WebCodecs preview — dimensions are known upfront, no element to wait on
   $effect(() => {
      if (!renderer || !frameSource) return;
      renderer.initVideoSource(frameSource.width, frameSource.height);
      naturalWidth = frameSource.width;
      naturalHeight = frameSource.height;
      imageReady = true;
   });

   // Video loading — initialises the renderer once metadata is available
   $effect(() => {
      if (!renderer || !videoEl || frameSource) return;
      imageReady = false;
      const video = videoEl;
      let ready = false;

      function onReady() {
         if (ready) return;
         ready = true;
         renderer!.loadVideo(video);
         naturalWidth = video.videoWidth;
         naturalHeight = video.videoHeight;
         imageReady = true;
         renderer!.updateSourceFrame(video);
         drawFrame(0);
      }

      // Wait for an actual decoded frame with known dimensions. In Firefox,
      // loadedmetadata (readyState 1) can report videoWidth 0 for some files;
      // initializing then allocates a 0×0 texture, every draw fails, and the
      // preview appears frozen while the video plays on.
      const isReady = () => video.readyState >= 2 && video.videoWidth > 0;

      // While the animation loop is running it handles per-frame uploads.
      // When the video is paused we still need to redraw after a seek.
      const onTimeUpdate = () => {
         if (!ready || needsAnimation) return;
         renderer!.updateSourceFrame(video);
         drawFrame(0);
      };

      if (isReady()) {
         onReady();
         video.addEventListener("timeupdate", onTimeUpdate);
         return () => video.removeEventListener("timeupdate", onTimeUpdate);
      }
      const events = ["loadeddata", "canplay", "resize", "timeupdate"];
      const tryReady = () => {
         if (!isReady()) return;
         for (const ev of events) video.removeEventListener(ev, tryReady);
         onReady();
      };
      for (const ev of events) video.addEventListener(ev, tryReady);
      video.addEventListener("timeupdate", onTimeUpdate);
      return () => {
         for (const ev of events) video.removeEventListener(ev, tryReady);
         video.removeEventListener("timeupdate", onTimeUpdate);
      };
   });

   // Resize the renderer when the preview box changes. The render itself is
   // handled by the animation loop while active; otherwise a static redraw is
   // triggered here. When externally driven, the parent owns all rendering.
   $effect(() => {
      if (suspended || !renderer || !imageReady || !renderSize) return;
      renderer.resize(renderSize.width, renderSize.height);
      if (!externallyDriven && !needsAnimation) drawFrame(0);
   });

   // Applied here rather than by the parent so a change also repaints a paused
   // canvas, through the static redraw driver below.
   $effect(() => {
      if (renderer) renderer.measureUploads = showFps;
   });

   $effect(() => {
      renderer?.setSourceFit(sourceFit);
   });

   // Same reason, and pushed rather than carried on each frame's layers: an
   // edit belongs to the media, so it is the same for every lane drawing it.
   $effect(() => {
      renderer?.setSourceEdits(new Map(Object.entries(sourceEdits)));
   });

   $effect(() => {
      renderer?.setSourceDurations(new Map(Object.entries(sourceDurations)));
   });

   // An erase mask is decoded from a data URL, so it lands a frame or two after
   // the edit does. Without this a paused preview keeps the un-erased picture
   // until something else happens to redraw it.
   $effect(() => {
      const r = renderer;
      if (!r) return;
      r.onMaskReady = () => {
         if (!suspended && !externallyDriven) drawFrame(0);
      };
      return () => {
         if (r.onMaskReady) r.onMaskReady = null;
      };
   });

   // Static redraw driver: subscribes to effect values and re-renders when the
   // animation loop is not running. Using a separate effect prevents double
   // renders during playback (the rAF loop already owns the frame).
   $effect(() => {
      if (suspended || !renderer || !imageReady || !renderSize) return;
      if (externallyDriven || needsAnimation) return;
      for (const e of effects) {
         e.enabled;
         for (const k of Object.keys(e.values)) e.values[k];
      }
      sourceFit;
      sourceEdits;
      sourceEditId;
      outgoingEditId;
      // Scrubbing a keyed edit moves the crop with no other reason to redraw.
      sourceEditTime;
      outgoingEditTime;
      // A caption font that lands after the frame was drawn changes its glyphs.
      fontTick;
      // Text edits and scrubbing both change which clip is on screen.
      readTextTimeline();
      readMediaTimeline();
      textTime;
      // Scrubbing onto another sequence source while paused: re-upload before
      // drawing. sourceKey also ticks when a late video upload lands, which is
      // what gets that frame onto a paused canvas.
      sourceKey;
      // Same hand-back problem as the animation loop, minus the frameSource
      // case (which always keeps that loop running). Gated on there being a
      // driver at all: without one nothing can have overwritten the texture,
      // and uploading here would cost a frame upload per slider tick.
      if (sourceDriver && !sourceDriver() && videoEl && !frameSource) {
         renderer.updateSourceFrame(videoEl);
      }
      drawFrame(0);
   });

   let fontTick = $state(0);
   $effect(() => onFontsChanged(() => fontTick++));

   /**
    * Touch every text field so a paused canvas redraws on any text edit. Read
    * straight from the effect rather than through a derived signature: an
    * effect re-runs whenever a dependency changes, so the string a derived had
    * to build (and JSON.stringify its way through) only ever existed to be
    * compared against itself.
    */
   /** Same purpose as readTextTimeline: touch every field a media lane draws
    * from, so a paused canvas redraws when one is edited. */
   function readMediaTimeline() {
      if (!mediaTimeline?.enabled) return;
      for (const l of mediaTimeline.lanes) {
         l.enabled;
         l.underEffects;
         l.z;
         l.sourceId;
         const style = l.style as unknown as Record<string, unknown>;
         for (const k of Object.keys(style)) style[k];
         for (const e of l.effects) {
            e.enabled;
            for (const k of Object.keys(e.values)) e.values[k];
         }
         for (const c of l.clips) {
            c.start;
            c.end;
            c.sourceStart;
            c.sourceId;
         }
      }
   }

   function readTextTimeline() {
      if (!textTimeline?.enabled) return;
      for (const l of textTimeline.lanes) {
         l.enabled;
         l.underEffects;
         l.z;
         const style = l.style as unknown as Record<string, unknown>;
         for (const k of Object.keys(style)) style[k];
         for (const e of l.effects) {
            e.enabled;
            for (const k of Object.keys(e.values)) e.values[k];
         }
         for (const c of l.clips) {
            c.start;
            c.end;
            c.text;
         }
      }
   }

   $effect(() => {
      if (suspended || !renderer || !imageReady) return;
      if (!needsAnimation) return;

      let rafId: number;
      let lastVideoTime = -1;
      let driverOwned = false;
      const loop = () => {
         const nowMs = performance.now();
         const owned = !!sourceDriver?.();
         // False means the primary is the outgoing side of a transition, so its
         // frame has to reach the alt texture as well as (or instead of) the
         // main one.
         const altFromPrimary = !!outgoingDriver && !outgoingDriver();
         // The frame a sequence segment borrowed the source texture for is
         // still on it. Both primary paths below only upload when something
         // changed, so without forcing one here a paused preview would keep
         // showing the other segment's media after the playhead left it.
         const handedBack = driverOwned && !owned;
         driverOwned = owned;
         if (!owned || altFromPrimary) {
            if (frameSource) {
               const frame = frameSource.takeFrame();
               if (frame) {
                  if (!owned) renderer!.updateSourceFrame(frame);
                  if (altFromPrimary) renderer!.updateAltSourceFrame(frame);
                  frame.close();
               } else if (handedBack) {
                  // The player only hands out newly-due frames; re-seeking to
                  // where it already is makes the next tick produce one.
                  frameSource.seek(frameSource.currentTime);
               }
            } else if (videoEl) {
               const t = videoEl.currentTime;
               if (!owned && (handedBack || t !== lastVideoTime)) {
                  renderer!.updateSourceFrame(videoEl);
                  lastVideoTime = t;
               }
               if (altFromPrimary) renderer!.updateAltSourceFrame(videoEl);
            }
         }
         const sourceDone = showFps ? performance.now() : 0;
         drawFrame(nowMs / 1000);
         if (showFps) trackFps(nowMs, sourceDone);
         rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);

      return () => cancelAnimationFrame(rafId);
   });
</script>

<!-- Selecting by pointer is a shortcut, not the only way in: every layer the
     canvas can be clicked on is also selectable from its timeline lane, which
     is where the keyboard and the screen reader work. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="preview-area" bind:this={previewArea} onpointerdown={pickLayerAt}>
   {#if !warmCanvas}
      <canvas
         bind:this={canvas}
         class="preview-canvas"
         aria-label="Effect preview canvas"
      ></canvas>
   {/if}
   {#if outline}
      <!-- Sits under .canvas-overlay: when that is up there is nothing on the
           canvas worth pointing at. -->
      <div
         class="layer-outline"
         style="left: {outline.left}px; top: {outline.top}px; width: {outline.w}px; height: {outline.h}px; transform: rotate({outline.rot}rad)"
      ></div>
   {/if}
   {#if overlay}
      <div class="canvas-overlay">{@render overlay()}</div>
   {/if}
   {#if error}
      <p class="error">{error}</p>
   {:else if showFps}
      <!-- The breakdown comes from this component's own loop, so it says
           nothing when a parent is driving the renderer instead. -->
      <span class="fps-overlay">
         {fps} FPS{#if !externallyDriven} · dec {decodeFps} · src {sourceMs.toFixed(
               1,
            )} gl {drawMs.toFixed(1)} up {uploadMs.toFixed(1)} · wait {waitMs.toFixed(
               1,
            )}ms{/if}
      </span>
   {/if}
   {#if fullscreen}
      <button
         class="fs-exit"
         title="Exit fullscreen (Esc)"
         onclick={() => (fullscreen = false)}
      >
         <Minimize size={16} />
      </button>
      {#if showFsHint}
         <span class="fs-hint">ESC TO EXIT · SPACE TO PLAY</span>
      {/if}
   {/if}
</div>

<style>
   .preview-area {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: var(--ink);
   }

   /* :global — the pre-warmed canvas is moved in via the DOM, so it never gets
	   Svelte's scoping attribute. */
   .preview-area :global(.preview-canvas) {
      max-width: 100%;
      max-height: 100%;
      border-radius: 2px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
   }

   /* Marks the selected layer's box while its clip panel is open, so the
	   placement sliders say which part of the frame they move. Dashed and thin:
	   it overlays live media and has to stay legible without competing with it.
	   Never interactive — every gesture here belongs to the preview. */
   .layer-outline {
      position: absolute;
      z-index: 8;
      border: 1px dashed var(--live);
      box-shadow:
         0 0 0 1px rgba(0, 0, 0, 0.55),
         inset 0 0 0 1px rgba(0, 0, 0, 0.55);
      pointer-events: none;
   }

   /* Opaque: whatever is still on the canvas underneath is stale by the time
	   anything wants to cover it. */
   .canvas-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ink);
      z-index: 9;
   }

   .error {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 0 1.5rem;
      color: var(--rec);
      font-size: 0.9rem;
      background: rgba(0, 0, 0, 0.55);
      z-index: 10;
   }

   .preview-area:fullscreen {
      background: var(--sunken);
   }

   /* Scale up to fill the screen on whichever axis runs out first, letterboxing
	   the other — object-fit: contain does this on a canvas, which max-width /
	   max-height alone can't (they cap, they never upscale). */
   .preview-area:fullscreen :global(.preview-canvas) {
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      object-fit: contain;
      border-radius: 0;
      box-shadow: none;
   }

   .fs-exit {
      position: absolute;
      top: 1rem;
      right: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.5);
      color: var(--text-2);
      cursor: pointer;
      opacity: 0;
      transition:
         opacity 0.1s,
         color 0.1s;
      z-index: 11;
   }

   /* Out of the way until the pointer moves — the point of fullscreen is to
	   see only the render. Focus-visible keeps it reachable by keyboard. */
   .preview-area:hover .fs-exit,
   .fs-exit:focus-visible {
      opacity: 1;
   }

   .fs-exit:hover {
      color: var(--text);
      border-color: rgba(255, 255, 255, 0.3);
   }

   .fs-hint {
      position: absolute;
      bottom: 1.6rem;
      left: 50%;
      transform: translateX(-50%);
      padding: 0.35rem 0.8rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.6);
      color: var(--text-2);
      font-size: 0.66rem;
      font-family: "Consolas", "Monaco", monospace;
      letter-spacing: 0.1em;
      pointer-events: none;
      z-index: 11;
      animation: fs-hint-fade 2.2s ease-out forwards;
   }

   @keyframes fs-hint-fade {
      0%,
      60% {
         opacity: 1;
      }
      100% {
         opacity: 0;
      }
   }

   .fps-overlay {
      position: absolute;
      top: 1.8rem;
      left: 1.8rem;
      background: rgba(0, 0, 0, 0.65);
      color: var(--live);
      font-size: 0.72rem;
      font-weight: 600;
      font-family: "Consolas", "Monaco", monospace;
      font-variant-numeric: tabular-nums;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      pointer-events: none;
      z-index: 10;
      letter-spacing: 0.04em;
   }
</style>
