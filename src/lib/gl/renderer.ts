import type { EffectInstance } from "../effects";
import { ASCII_CHARSETS } from "../effects/definitions";
import { ensureFontLoaded, fontsVersion } from "../text-overlay";
import {
  drawTextToCanvas,
  textSignature,
  type ResolvedTextLayer,
} from "../text";
import {
  CAPTION_EFFECT_ID,
  captionSignature,
  drawCaptionToCanvas,
  readCaptionParams,
} from "../caption";
import { DEFAULT_AUDIO_RESPONSE } from "../audio/auto-range";
import {
  dropSpectrumFollower,
  normalizeSpectrum,
  smoothSpectrum,
} from "../audio/spectrum-range";
import { createProgram, getUniformLocations } from "./utils";
import {
  VERTEX_SHADER,
  PASSTHROUGH_FRAG,
  TEXT_BLEND_FRAG,
  EFFECT_SHADERS,
  ASCII_GLYPH_CELL,
  type EffectShaderDef,
} from "./effect-shaders";
import { TRANSITION_SHADERS } from "./transition-shaders";
import type { TextOverlayBlendMode } from "../text-overlay";
import {
  TRACKING_EFFECT_ID,
  computeSaliency,
  lumFromRGBA,
  readTrackingParams,
  syncBoxes,
  resolveFrame,
  trackBoxes,
  drawTrackingToCanvas,
  trackingFrameSignature,
  type TrackingParams,
  type TrackingState,
} from "../tracking";

/** A 2D-drawn overlay uploaded as a texture, kept until its content or the
 * output size changes. `sig` is everything the draw depended on. */
interface OverlayTexture {
  tex: WebGLTexture;
  w: number;
  h: number;
  sig: string;
}

/** Framebuffer statuses already reported, so a broken target logs once rather
 * than once per allocation. */
const reportedFBOStatuses = new Set<number>();

/** Effect ids already warned about, so a stale preset logs once, not per frame. */
const reportedUnknownEffects = new Set<string>();

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation>;
}

/**
 * How a source whose aspect ratio differs from the output is fitted. Only
 * reachable with a mixed media pool — a single source always defines the
 * output aspect itself.
 */
export type SourceFit = "stretch" | "contain" | "cover";

/** A text layer with its own chain already rendered, ready to composite. */
interface PreparedTextLayer {
  tex: WebGLTexture;
  chainIndex: number;
  opacity: number;
  blendMode: TextOverlayBlendMode;
}

type ChainOp =
  | { kind: "effect"; eff: EffectInstance }
  | { kind: "layer"; layer: PreparedTextLayer };

/**
 * Interleave text layers into the effect chain at their insertion points. A
 * layer sits *before* the effect at its index, so index 0 hands the text to
 * every effect and an index at or past the end lays it over the finished frame.
 */
function buildChainOps(
  effects: EffectInstance[],
  enabledCount: number,
  layers: PreparedTextLayer[],
): ChainOp[] {
  const ops: ChainOp[] = [];
  let i = 0;
  for (const eff of effects) {
    if (!eff.enabled) continue;
    for (const layer of layers) {
      const at = Math.min(Math.max(layer.chainIndex, 0), enabledCount);
      if (at === i) ops.push({ kind: "layer", layer });
    }
    ops.push({ kind: "effect", eff });
    i++;
  }
  // Layers at or past the end lay over the finished frame.
  for (const layer of layers) {
    if (Math.min(Math.max(layer.chainIndex, 0), enabledCount) === enabledCount) {
      ops.push({ kind: "layer", layer });
    }
  }
  return ops;
}

function countEnabled(effects: EffectInstance[]): number {
  let n = 0;
  for (const e of effects) if (e.enabled) n++;
  return n;
}

/**
 * One stacked fx lane's contribution for a frame: the chain it adds, and how
 * strongly it applies. A weight below 1 mixes the lane's output back over its
 * input, which is what fades a lane's clip in and out at its edges — there is
 * no "other side" to blend against the way a source-lane transition has one.
 */
export interface PostChainLayer {
  effects: EffectInstance[];
  /** 0 = lane absent, 1 = fully applied. */
  weight: number;
}

/** Lanes that actually change the frame — the rest are skipped entirely. */
function livePostLayers(layers: PostChainLayer[]): PostChainLayer[] {
  return layers.filter((l) => l.weight > 0 && l.effects.some((e) => e.enabled));
}

/** True when every live lane applies at full strength, so they can run as one
 * concatenated chain with no intermediate buffers — the common case. */
function allFullWeight(layers: PostChainLayer[]): boolean {
  return layers.every((l) => l.weight >= 1);
}

/** Collect instance ids into `live`, so feedback buffers survive the GC. Fills a
 * caller-owned set: this runs every frame, and the intermediate arrays a
 * returning version needed were pure garbage. */
function addInstanceIds(live: Set<string>, effects: EffectInstance[]): void {
  for (const e of effects) live.add(e.instanceId);
}

function addLayerInstanceIds(
  live: Set<string>,
  layers: ResolvedTextLayer[],
): void {
  for (const layer of layers) addInstanceIds(live, layer.effects);
}

function addPostInstanceIds(live: Set<string>, post: PostChainLayer[]): void {
  for (const l of post) addInstanceIds(live, l.effects);
}

export class GlRenderer {
  private gl: WebGL2RenderingContext;
  private quadVAO: WebGLVertexArrayObject;
  private sourceTexture: WebGLTexture | null = null;
  private sourceFit: SourceFit = "contain";
  /**
   * Second source texture, holding the *outgoing* segment's media while a
   * transition runs. Only allocated once a transition actually crosses two
   * different sources.
   */
  private altSourceTexture: WebGLTexture | null = null;
  private altTexW = 0;
  private altTexH = 0;
  private altStageTexture: WebGLTexture | null = null;
  private altStageFBO: WebGLFramebuffer | null = null;
  /** Output-sized copy of the source, letterboxed or cropped. Only allocated
   * once a source whose aspect differs from the output actually arrives. */
  private stageTexture: WebGLTexture | null = null;
  private stageFBO: WebGLFramebuffer | null = null;
  /** Allocated dimensions of sourceTexture, so per-frame uploads can take the
   * texSubImage2D fast path when the size is unchanged and only reallocate on
   * an actual size change (mixed-size slideshow slides). */
  private srcTexW = 0;
  private srcTexH = 0;
  private ppTextures: [WebGLTexture, WebGLTexture] | null = null;
  private ppFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  /**
   * Final result buffer. Only needed when an overlay has to be composited over
   * the chain; when there's no overlay, the last effect draws straight to the
   * canvas to avoid an extra full-screen blit.
   */
  private fbTexture: WebGLTexture | null = null;
  private fbFBO: WebGLFramebuffer | null = null;
  /**
   * Half-float ping-pong for HDR multi-pass effects (bloom/blur). Allocated at
   * a fraction of the output resolution: the Gaussian pre-passes are the
   * heaviest part of these effects, and their result is low-frequency, so a
   * half-res blur + linear upsample is visually ~identical for a 4× fill cut.
   * The blur shaders derive pixel size from u_resolution (full res), so the
   * screen-space blur width is unchanged by this downsampling.
   */
  private hdrTextures: [WebGLTexture, WebGLTexture] | null = null;
  private hdrFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private hdrW = 0;
  private hdrH = 0;
  /** Per-side outputs for transitions: chain A and chain B render into these. */
  private sceneTextures: [WebGLTexture, WebGLTexture] | null = null;
  private sceneFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  /** Holds a finished transition blend while a post chain runs over it. Only
   * allocated when something actually stacks on top of a blend. */
  private blendTexture: WebGLTexture | null = null;
  private blendFBO: WebGLFramebuffer | null = null;
  /**
   * Rotation for the stacked fx lanes. Three, not two: fading a lane needs its
   * input and its output both readable while a third buffer takes the mix, and
   * the ping-pong pair is already in use inside each lane's own chain. Only
   * allocated when a lane actually stacks.
   */
  private stackTextures: WebGLTexture[] | null = null;
  private stackFBOs: WebGLFramebuffer[] | null = null;
  private transitionPrograms = new Map<string, CompiledProgram>();
  /**
   * Private history buffers for feedback-reading effects (u_feedback), keyed
   * by effect instanceId. Each such effect feeds back its OWN previous output
   * — not the chain composite — so downstream effects can't create runaway
   * loops (e.g. melt -> bleach crushing shadows to black over a second).
   */
  private fxFeedback = new Map<
    string,
    {
      textures: [WebGLTexture, WebGLTexture];
      fbos: [WebGLFramebuffer, WebGLFramebuffer];
      idx: number;
    }
  >();
  private passthrough: CompiledProgram;
  private compiled = new Map<
    string,
    {
      program: CompiledProgram;
      def: EffectShaderDef;
      prePasses?: { program: CompiledProgram; linearFilter?: boolean }[];
    }
  >();
  private textBlendProgram: CompiledProgram | null = null;
  /** Drawn (pre-effect) text per clip, keyed by clip id. */
  private textLayerTextures = new Map<string, OverlayTexture>();
  private textLayerCanvas: HTMLCanvasElement | null = null;
  /** Scratch targets holding each layer's own chain output for this frame. */
  private layerBuffers: { tex: WebGLTexture; fbo: WebGLFramebuffer }[] = [];
  private imgW = 0;
  private imgH = 0;
  private lastTime = -1;
  /** Refilled every frame by beginLiveIds, so the GC pass costs no allocation. */
  private liveIds = new Set<string>();
  /** Reused by getEffectTime; read out before the next call overwrites it. */
  private effectTimeOut = { time: 0, delta: 0 };
  private phaseMap = new Map<string, number>();

  /**
   * Caption overlay textures, keyed by instanceId — unlike tracking there can
   * be any number of captions in one chain, each with its own drawn text.
   */
  private captionTextures = new Map<string, OverlayTexture>();
  private captionCanvas: HTMLCanvasElement | null = null;

  // --- Tracking overlay effect (2D-canvas HUD composited into the chain) ---
  private trackingStates = new Map<string, TrackingState>();
  private trackingCanvas: HTMLCanvasElement | null = null;
  private trackingTexture: WebGLTexture | null = null;
  private trackingTexW = 0;
  private trackingTexH = 0;
  /** Signature of the HUD currently uploaded in trackingTexture (skip redraws). */
  private lastTrackingSig = "";
  private salFBO: WebGLFramebuffer | null = null;
  private salTexture: WebGLTexture | null = null;
  private salBuf: Uint8Array | null = null;
  private salW = 0;
  private salH = 0;
  /** PBO for non-blocking saliency readback + the in-flight fence, if any. */
  private salPBO: WebGLBuffer | null = null;
  private salFence: WebGLSync | null = null;
  private salPending: {
    state: TrackingState;
    params: TrackingParams;
    time: number;
  } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
    gl.getExtension("EXT_color_buffer_float");
    this.quadVAO = this.createQuad();
    this.passthrough = this.compile(PASSTHROUGH_FRAG);
    this.textBlendProgram = this.compile(TEXT_BLEND_FRAG);
    for (const set of ASCII_CHARSETS) {
      this.glyphTextures.set(
        set.value,
        this.buildGlyphAtlas(set.chars),
      );
    }
    this.compileAllEffects();
    for (const [id, def] of Object.entries(TRANSITION_SHADERS)) {
      try {
        this.transitionPrograms.set(id, this.compile(def.fragment));
      } catch (e) {
        console.error(`Failed to compile transition "${id}":`, e);
      }
    }
  }

  /**
   * How a canvas parked in <body> has to be styled to hold its GL context
   * without affecting the page.
   *
   * `position:fixed` and an explicit 1px box, not `position:absolute` alone: an
   * absolutely positioned element with no offsets sits at its static position —
   * the end of <body> — and still contributes to the document's scrollable
   * overflow. `visibility:hidden` hides the pixels but keeps the layout box, so
   * a parked canvas carrying its last render size (hundreds of pixels tall) gave
   * the editor a phantom vertical scrollbar.
   */
  static readonly PARKED_CANVAS_STYLE =
    "position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none";

  /**
   * Pre-compile all shaders on a hidden 1×1 canvas so the first real render
   * doesn't pay the compilation cost. Returns the warmed renderer + its canvas;
   * pass both into GlCanvas via the `warmCanvas`/`warmRenderer` props.
   */
  static warmup(): { canvas: HTMLCanvasElement; renderer: GlRenderer } {
    // Sweep any warm canvas still parked from a previous cycle. Only direct
    // children of <body> qualify: one adopted into an editor lives inside that
    // editor's DOM and is still in use.
    for (const stale of document.body.querySelectorAll(
      ":scope > canvas[data-openmosh-warm]",
    )) {
      stale.remove();
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.openmoshWarm = "1";
    canvas.style.cssText = GlRenderer.PARKED_CANVAS_STYLE;
    document.body.appendChild(canvas);
    const renderer = new GlRenderer(canvas);
    return { canvas, renderer };
  }

  /**
   * Update the internal canvas reference after the canvas element has been
   * moved in the DOM (e.g. from the hidden warmup container into the editor).
   * The WebGL context stays intact — only the canvas pointer is updated.
   */
  adoptCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  loadImage(image: HTMLImageElement) {
    if (!this.resetSource(image.naturalWidth, image.naturalHeight)) return;
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  loadVideo(video: HTMLVideoElement) {
    if (!this.resetSource(video.videoWidth, video.videoHeight)) return;
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  /**
   * Allocate the source texture/FBOs for externally-decoded VideoFrames
   * (WebCodecs preview) — like loadVideo, but without an element to sample.
   */
  initVideoSource(w: number, h: number) {
    this.resetSource(w, h);
  }

  /**
   * Size the output to `w`×`h` and hand back a freshly bound source texture for
   * the caller to upload into. False when the dimensions aren't usable yet: a
   * 0×0 source texture makes every subsequent draw fail, freezing the preview
   * on the last presented frame (preserveDrawingBuffer).
   */
  private resetSource(w: number, h: number): boolean {
    if (w === 0 || h === 0) return false;
    const gl = this.gl;
    this.imgW = w;
    this.imgH = h;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = this.createTexture(w, h);
    this.srcTexW = w;
    this.srcTexH = h;

    this.setupPingPong();
    return true;
  }

  updateSourceFrame(source: HTMLVideoElement | VideoFrame) {
    if (!this.sourceTexture) return;
    // Skip uploads while the element has no decoded frame (seeking/stalled) —
    // Firefox would upload zeros, flashing black instead of holding the frame
    if (
      source instanceof HTMLVideoElement &&
      (source.readyState < 2 || source.videoWidth === 0)
    ) {
      return;
    }
    const w =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source.displayWidth;
    const h =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source.displayHeight;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    // Fast path: texSubImage2D writes into the existing allocation (the usual
    // case — a video plays at constant dimensions). texImage2D would reallocate
    // and revalidate storage every frame. Reallocate only on an actual size
    // change (e.g. a mixed-size slideshow switching source mid-preview).
    if (w === this.srcTexW && h === this.srcTexH) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.srcTexW = w;
      this.srcTexH = h;
    }
  }

  /** Upload a new image to the existing source texture without re-allocating FBOs. */
  updateSourceImage(image: HTMLImageElement) {
    if (!this.sourceTexture) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.srcTexW = image.naturalWidth;
    this.srcTexH = image.naturalHeight;
  }

  // ── Outgoing source (transitions across two different media) ─────────────

  /** Whether anything has been staged for the outgoing side yet. */
  get hasAltSource(): boolean {
    return !!this.altSourceTexture;
  }

  updateAltSourceImage(image: HTMLImageElement) {
    this.uploadAlt(image, image.naturalWidth, image.naturalHeight);
  }

  updateAltSourceFrame(source: HTMLVideoElement | VideoFrame) {
    if (
      source instanceof HTMLVideoElement &&
      (source.readyState < 2 || source.videoWidth === 0)
    ) {
      return;
    }
    const w =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source.displayWidth;
    const h =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source.displayHeight;
    this.uploadAlt(source, w, h);
  }

  /** Forget the outgoing media so a later transition can't reuse a stale frame. */
  clearAltSource() {
    const gl = this.gl;
    if (this.altSourceTexture) gl.deleteTexture(this.altSourceTexture);
    this.altSourceTexture = null;
    this.altTexW = 0;
    this.altTexH = 0;
    this.deleteAltStageBuffer();
  }

  private uploadAlt(
    source: TexImageSource,
    w: number,
    h: number,
  ) {
    if (w <= 0 || h <= 0) return;
    const gl = this.gl;
    if (!this.altSourceTexture) {
      this.altSourceTexture = this.createTexture(w, h);
      this.altTexW = w;
      this.altTexH = h;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.altSourceTexture);
    if (w === this.altTexW && h === this.altTexH) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.altTexW = w;
      this.altTexH = h;
      this.deleteAltStageBuffer();
    }
  }

  /** Resize output canvas and ping-pong/feedback buffers. Source texture is unchanged; sampling scales automatically. */
  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    if (width === this.imgW && height === this.imgH) return;
    this.imgW = width;
    this.imgH = height;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.setupPingPong();
  }

  render(
    effects: EffectInstance[],
    time = 0,
    textLayers: ResolvedTextLayer[] = [],
    /** Stacked fx lanes, run over the finished chain. See PostChainLayer. */
    postLayers: PostChainLayer[] = [],
  ) {
    if (
      !this.sourceTexture ||
      !this.ppTextures ||
      !this.ppFBOs
    )
      return;

    const post = livePostLayers(postLayers);
    const live = this.beginLiveIds();
    addInstanceIds(live, effects);
    addPostInstanceIds(live, post);
    addLayerInstanceIds(live, textLayers);
    this.gcFxFeedback(live);
    this.gcTextLayers(textLayers);
    const safeDt = this.frameDelta(time);
    this.ensurePresentBuffer();
    const presentFBO = this.fbFBO;
    const presentTex = this.fbTexture;
    // Narrowed rather than asserted: createRenderTarget can genuinely fail, and
    // there is nothing to draw into if it did.
    if (!presentFBO || !presentTex) return;
    // Text layers run their own chains through the shared ping-pong, so they
    // have to be finished before the main chain starts using it.
    const prepared = this.prepareTextLayers(textLayers, time, safeDt);

    // Nothing stacked, or nothing fading: one chain, no intermediate buffers.
    // This is the path every non-sequence render takes.
    if (post.length === 0 || allFullWeight(post)) {
      let flat = effects;
      if (post.length > 0) {
        // Built by hand rather than with flatMap, which would allocate a second
        // array per frame just to spread it into this one.
        flat = effects.slice();
        for (const l of post) flat.push(...l.effects);
      }
      const resultTex = this.renderChainTo(
        flat,
        time,
        safeDt,
        presentFBO,
        presentTex,
        true,
        false,
        prepared,
      );
      this.presentFrame(resultTex);
      return;
    }

    // A fading lane has to mix against its own input, so the source chain lands
    // in a buffer rather than going straight to the canvas.
    this.ensureSceneBuffers();
    const sceneFBOs = this.sceneFBOs;
    const sceneTextures = this.sceneTextures;
    if (!sceneFBOs || !sceneTextures) return;
    const baseTex = this.renderChainTo(
      effects,
      time,
      safeDt,
      sceneFBOs[0],
      sceneTextures[0],
      false,
      false,
      prepared,
    )!;
    this.presentFrame(this.renderStack(post, baseTex, time, safeDt));
  }

  /**
   * Blend two effect chains with a transition shader: chain A (outgoing) and
   * chain B (incoming) each render into their own scene buffer — feedback
   * effects on both sides keep evolving during the blend — then the
   * transition pass composites them along `progress` (0 = pure A, 1 = pure B).
   */
  renderTransition(
    effectsA: EffectInstance[],
    effectsB: EffectInstance[],
    type: string,
    progress: number,
    seed: number,
    direction: number,
    density: number,
    time = 0,
    /** Render chain A from the outgoing source texture — set when the two
     * segments draw from different media, so the media cross-fades too. */
    useAltSourceForA = false,
    textLayers: ResolvedTextLayer[] = [],
    /**
     * Stacked fx lanes, run over the finished blend — they sit above the source
     * lane, so they apply to whatever it produced, blend included. Deliberately
     * *not* appended to both sides: chains A and B render separately, so the
     * same instance on both would have two passes writing one feedback buffer,
     * each reading the other's history.
     */
    postLayers: PostChainLayer[] = [],
  ) {
    if (
      !this.sourceTexture ||
      !this.ppTextures ||
      !this.ppFBOs
    )
      return;
    const post = livePostLayers(postLayers);
    const prog = this.transitionPrograms.get(type);
    if (!prog || progress >= 1) {
      this.render(effectsB, time, textLayers, post);
      return;
    }

    // Every chain stays alive for the whole blend — collect feedback buffers
    // only against the union, or rendering A would drop B's history.
    const live = this.beginLiveIds();
    addInstanceIds(live, effectsA);
    addInstanceIds(live, effectsB);
    addPostInstanceIds(live, post);
    addLayerInstanceIds(live, textLayers);
    this.gcFxFeedback(live);
    this.gcTextLayers(textLayers);
    const safeDt = this.frameDelta(time);

    // One preparation feeding both sides: the text is the same layer, so it
    // rides through the blend rather than popping in when B takes over.
    const prepared = this.prepareTextLayers(textLayers, time, safeDt);

    this.ensureSceneBuffers();
    const sceneFBOs = this.sceneFBOs;
    const sceneTextures = this.sceneTextures;
    if (!sceneFBOs || !sceneTextures) return;
    const texA = this.renderChainTo(
      effectsA,
      time,
      safeDt,
      sceneFBOs[0],
      sceneTextures[0],
      false,
      useAltSourceForA && !!this.altSourceTexture,
      prepared,
    );
    const texB = this.renderChainTo(
      effectsB,
      time,
      safeDt,
      sceneFBOs[1],
      sceneTextures[1],
      false,
      false,
      prepared,
    );

    this.ensurePresentBuffer();
    const presentFBO = this.fbFBO;
    if (!presentFBO) return;

    // Nothing stacked on top: blend straight into the present buffer.
    if (post.length === 0) {
      this.drawTransitionPass(
        prog,
        presentFBO,
        texA!,
        texB!,
        progress,
        seed,
        direction,
        density,
        time,
      );
      this.presentFrame(this.fbTexture);
      return;
    }

    // A post chain reads the blend, so the blend can't land in the buffer that
    // chain writes to. Park it in its own texture and hand that over as the
    // chain's source; text layers stay on A and B, where they ride through the
    // blend rather than popping in when B takes over.
    this.ensureBlendBuffer();
    const blendFBO = this.blendFBO;
    const blendTexture = this.blendTexture;
    if (!blendFBO || !blendTexture) return;
    this.drawTransitionPass(
      prog,
      blendFBO,
      texA!,
      texB!,
      progress,
      seed,
      direction,
      density,
      time,
    );
    this.presentFrame(
      this.renderStack(post, blendTexture, time, safeDt),
    );
  }

  setSourceFit(fit: SourceFit) {
    this.sourceFit = fit;
  }

  /**
   * The texture the effect chain should read.
   *
   * Uploads keep their own dimensions, so a source that doesn't share the
   * output's aspect would be stretched across it by the chain's 0..1 sampling.
   * When that happens (only possible with a mixed media pool) the source is
   * first copied into an output-sized buffer, scaled to fit and centred, and
   * the chain reads that instead. Matching aspects skip the copy entirely, so
   * the ordinary single-source case pays nothing.
   */
  private chainSource(alt = false): WebGLTexture {
    const src = alt ? this.altSourceTexture : this.sourceTexture;
    if (!src) return this.sourceTexture!;
    if (this.sourceFit === "stretch") return src;
    const sw = alt ? this.altTexW : this.srcTexW;
    const sh = alt ? this.altTexH : this.srcTexH;
    if (sw <= 0 || sh <= 0 || this.imgW <= 0 || this.imgH <= 0) return src;
    // Sub-pixel differences aren't worth a full-screen pass.
    if (Math.abs(sw / sh - this.imgW / this.imgH) < 0.002) return src;

    const gl = this.gl;
    let stageTex = alt ? this.altStageTexture : this.stageTexture;
    let stageFbo = alt ? this.altStageFBO : this.stageFBO;
    if (!stageTex || !stageFbo) {
      stageTex = this.createTexture(this.imgW, this.imgH);
      const fbo = this.createRenderTarget(stageTex);
      if (!fbo) return src;
      stageFbo = fbo;
      if (alt) {
        this.altStageTexture = stageTex;
        this.altStageFBO = fbo;
      } else {
        this.stageTexture = stageTex;
        this.stageFBO = fbo;
      }
    }

    const scale =
      this.sourceFit === "cover"
        ? Math.max(this.imgW / sw, this.imgH / sh)
        : Math.min(this.imgW / sw, this.imgH / sh);
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const x = Math.round((this.imgW - w) / 2);
    const y = Math.round((this.imgH - h) / 2);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stageFbo);
    // Clear at full size first, then draw into the fitted rect — "contain"
    // leaves the bars black, "cover" simply clips outside the viewport.
    gl.viewport(0, 0, this.imgW, this.imgH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(x, y, w, h);
    gl.useProgram(this.passthrough.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    if (this.passthrough.uniforms["u_texture"]) {
      gl.uniform1i(this.passthrough.uniforms["u_texture"], 0);
    }
    if (this.passthrough.uniforms["u_flipY"]) {
      gl.uniform1f(this.passthrough.uniforms["u_flipY"], 1.0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return stageTex;
  }

  private deleteStageBuffer() {
    const gl = this.gl;
    if (this.stageTexture) gl.deleteTexture(this.stageTexture);
    if (this.stageFBO) gl.deleteFramebuffer(this.stageFBO);
    this.stageTexture = null;
    this.stageFBO = null;
    this.deleteAltStageBuffer();
  }

  private deleteAltStageBuffer() {
    const gl = this.gl;
    if (this.altStageTexture) gl.deleteTexture(this.altStageTexture);
    if (this.altStageFBO) gl.deleteFramebuffer(this.altStageFBO);
    this.altStageTexture = null;
    this.altStageFBO = null;
  }

  /** Per-frame delta time for phase accumulation, guarded against discontinuities. */
  /** The shared live-id set, emptied and ready to refill. */
  private beginLiveIds(): Set<string> {
    this.liveIds.clear();
    return this.liveIds;
  }

  private frameDelta(time: number): number {
    const dt = this.lastTime >= 0 ? time - this.lastTime : 0;
    this.lastTime = time;
    // Guard against time discontinuities (e.g. switching between recording and real-time)
    return dt > 0 && dt < 0.5 ? dt : 0;
  }

  /** Drop per-instance state for effects that no longer exist (deleted, or
   * replaced wholesale by undo/preset): feedback GPU buffers, plus the phase,
   * tracking and caption maps. Every mosh roll mints fresh instanceIds, so
   * without this the latter three grow unbounded across a long session. */
  private gcFxFeedback(live: Set<string>) {
    for (const [id, pair] of this.fxFeedback) {
      if (!live.has(id)) {
        this.deleteTexturePair(pair.textures);
        this.deleteFBOPair(pair.fbos);
        this.fxFeedback.delete(id);
      }
    }
    for (const id of this.phaseMap.keys()) {
      if (!live.has(id)) this.phaseMap.delete(id);
    }
    for (const id of this.spectrumSmoothed.keys()) {
      if (!live.has(id)) {
        this.spectrumSmoothed.delete(id);
        dropSpectrumFollower(id);
      }
    }
    for (const id of this.trackingStates.keys()) {
      if (!live.has(id)) this.trackingStates.delete(id);
    }
    for (const [id, entry] of this.captionTextures) {
      if (!live.has(id)) {
        this.gl.deleteTexture(entry.tex);
        this.captionTextures.delete(id);
      }
    }
  }

  /** Drop every cached caption texture (resize, teardown). */
  private clearCaptionTextures() {
    for (const entry of this.captionTextures.values()) {
      this.gl.deleteTexture(entry.tex);
    }
    this.captionTextures.clear();
  }

  /**
   * Render one effect chain, writing the final pass into `finalFbo` and
   * returning the texture holding the result (a private feedback buffer when
   * the last effect reads u_feedback). Intermediate passes share the
   * ping-pong FBOs, so chains must run sequentially — which is why text layers
   * arrive already rendered.
   */
  private renderChainTo(
    effects: EffectInstance[],
    time: number,
    safeDt: number,
    finalFbo: WebGLFramebuffer,
    finalTex: WebGLTexture,
    toCanvas: boolean,
    useAltSource = false,
    layers: PreparedTextLayer[] = [],
    srcOverride?: WebGLTexture,
  ): WebGLTexture | null {
    const srcTex = srcOverride ?? this.chainSource(useAltSource);
    const ops = buildChainOps(effects, countEnabled(effects), layers);

    if (ops.length === 0) {
      if (toCanvas) {
        this.drawPass(this.passthrough, null, srcTex, -1.0, time);
        return null;
      }
      this.drawPass(this.passthrough, finalFbo, srcTex, 1.0, time);
      return finalTex;
    }

    let input = srcTex;
    let ppIdx = 0;
    /** Texture holding the final chain output (presented at the end); null
     * either when nothing has rendered yet or when the last pass drew
     * straight to the canvas (toCanvas) — `producedOutput` disambiguates. */
    let resultTex: WebGLTexture | null = null;
    let producedOutput = false;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const isLast = i === ops.length - 1;

      // A text layer is composited over whatever the chain holds at its slot,
      // so effects below it in the chain go on to distort it. It always lands
      // in an FBO — the final blit is left to presentFrame.
      if (op.kind === "layer") {
        const target = isLast ? finalFbo : this.ppFBOs![ppIdx];
        this.compositeOverlayToFBO(
          input,
          op.layer.tex,
          target,
          op.layer.opacity,
          op.layer.blendMode,
        );
        if (isLast) {
          resultTex = finalTex;
          producedOutput = true;
        } else {
          input = this.ppTextures![ppIdx];
          ppIdx = 1 - ppIdx;
        }
        continue;
      }

      const eff = op.eff;

      // Tracking and captions are CPU-built 2D overlays, not shader passes.
      // Composite them over the chain input at this slot, so later effects can
      // distort them.
      if (eff.defId === TRACKING_EFFECT_ID || eff.defId === CAPTION_EFFECT_ID) {
        const target = isLast ? finalFbo : this.ppFBOs![ppIdx];
        if (eff.defId === CAPTION_EFFECT_ID) {
          this.renderCaption(eff, input, target);
        } else {
          this.renderTracking(eff, input, target, time);
        }
        if (isLast) {
          resultTex = finalTex;
          producedOutput = true;
        } else {
          input = this.ppTextures![ppIdx];
          ppIdx = 1 - ppIdx;
        }
        continue;
      }

      const entry = this.compiled.get(eff.defId);
      if (!entry) {
        // A stale preset or a deleted effect. Skipping is right — reporting it
        // once is what makes "my preset does nothing" diagnosable.
        if (!reportedUnknownEffects.has(eff.defId)) {
          reportedUnknownEffects.add(eff.defId);
          console.warn(`No shader for effect "${eff.defId}" — skipping it.`);
        }
        continue;
      }

      if (entry.program.uniforms["u_spectrum"]) this.uploadSpectrumFor(eff);

      const { time: effectTime, delta: effectDelta } = this.getEffectTime(
        eff,
        time,
        safeDt,
      );

      // Multi-pass effects: run pre-passes through the half-res HDR ping-pong,
      // then composite. The pre-pass viewport is the HDR buffer size; the
      // shaders use u_resolution (full res) for blur width, so downsampling
      // only lowers the sample resolution, not the blur radius.
      const originalInput = input;
      if (entry.prePasses) {
        this.ensureHdrBuffers();
        let hdrIdx = 0;
        for (const pp of entry.prePasses) {
          if (pp.linearFilter) this.setTextureFilter(input, true);
          this.drawPass(
            pp.program,
            this.hdrFBOs![hdrIdx],
            input,
            1.0,
            effectTime,
            entry.def,
            eff.values,
            undefined,
            undefined,
            undefined,
            this.hdrW,
            this.hdrH,
          );
          if (pp.linearFilter) this.setTextureFilter(input, false);
          input = this.hdrTextures![hdrIdx];
          hdrIdx = 1 - hdrIdx;
        }
        // The composite reads the final blurred buffer at full res — keep it
        // LINEAR so the upsample is smooth (setTextureFilter may have left the
        // shared source texture NEAREST above; HDR textures are LINEAR-native).
        this.setTextureFilter(input, true);
      }

      if (entry.def.linearFilter) this.setTextureFilter(input, true);

      if (entry.program.uniforms["u_feedback"]) {
        // Feedback effect: render into its private history buffer, reading
        // its own previous output — downstream effects never enter the loop.
        const pair = this.getFxFeedback(
          eff.instanceId,
          input,
          time,
          entry.def.hdrFeedback,
        );
        const writeSlot = 1 - pair.idx;
        this.drawPass(
          entry.program,
          pair.fbos[writeSlot],
          input,
          1.0,
          effectTime,
          entry.def,
          eff.values,
          entry.prePasses ? originalInput : undefined,
          effectDelta,
          pair.textures[pair.idx],
        );
        pair.idx = writeSlot as 0 | 1;
        if (entry.def.linearFilter) this.setTextureFilter(input, false);
        input = pair.textures[writeSlot];
        if (isLast) {
          resultTex = input;
          producedOutput = true;
        }
        continue;
      }

      if (isLast) {
        if (toCanvas) {
          this.drawPass(
            entry.program,
            null,
            input,
            -1.0,
            effectTime,
            entry.def,
            eff.values,
            entry.prePasses ? originalInput : undefined,
            effectDelta,
          );
        } else {
          this.drawPass(
            entry.program,
            finalFbo,
            input,
            1.0,
            effectTime,
            entry.def,
            eff.values,
            entry.prePasses ? originalInput : undefined,
            effectDelta,
          );
        }
        if (entry.def.linearFilter) this.setTextureFilter(input, false);
        resultTex = toCanvas ? null : finalTex;
        producedOutput = true;
      } else {
        this.drawPass(
          entry.program,
          this.ppFBOs![ppIdx],
          input,
          1.0,
          effectTime,
          entry.def,
          eff.values,
          entry.prePasses ? originalInput : undefined,
          effectDelta,
        );
        if (entry.def.linearFilter) this.setTextureFilter(input, false);
        input = this.ppTextures![ppIdx];
        ppIdx = 1 - ppIdx;
      }
    }

    // Every enabled effect was skipped (unknown ids): fall back to source
    if (!producedOutput) {
      if (toCanvas) {
        this.drawPass(this.passthrough, null, srcTex, -1.0, time);
      } else {
        this.drawPass(this.passthrough, finalFbo, srcTex, 1.0, time);
      }
      resultTex = toCanvas ? null : finalTex;
    }

    return resultTex;
  }

  /** Composite outgoing (texA) + incoming (texB) chain outputs along progress. */
  private drawTransitionPass(
    prog: CompiledProgram,
    targetFBO: WebGLFramebuffer,
    texA: WebGLTexture,
    texB: WebGLTexture,
    progress: number,
    seed: number,
    direction: number,
    density: number,
    time: number,
  ) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
    gl.viewport(0, 0, this.imgW, this.imgH);
    gl.useProgram(prog.program);
    if (prog.uniforms["u_flipY"]) gl.uniform1f(prog.uniforms["u_flipY"], 1.0);
    if (prog.uniforms["u_progress"])
      gl.uniform1f(prog.uniforms["u_progress"], progress);
    if (prog.uniforms["u_seed"]) gl.uniform1f(prog.uniforms["u_seed"], seed);
    if (prog.uniforms["u_direction"])
      gl.uniform1i(prog.uniforms["u_direction"], direction);
    if (prog.uniforms["u_density"])
      gl.uniform1i(prog.uniforms["u_density"], density);
    if (prog.uniforms["u_resolution"])
      gl.uniform2f(prog.uniforms["u_resolution"], this.imgW, this.imgH);
    if (prog.uniforms["u_time"]) gl.uniform1f(prog.uniforms["u_time"], time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    if (prog.uniforms["u_texture"]) gl.uniform1i(prog.uniforms["u_texture"], 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    if (prog.uniforms["u_texture2"])
      gl.uniform1i(prog.uniforms["u_texture2"], 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Blit the finished frame to the canvas, when the chain didn't already. */
  private presentFrame(mainResult: WebGLTexture | null) {
    // A feedback effect at the end of the chain writes to its own history
    // buffer, so it needs this final blit; otherwise the last pass already
    // drew straight to the canvas.
    if (mainResult) this.drawPass(this.passthrough, null, mainResult, -1.0, 0);
  }

  /**
   * Get (or lazily create) the private history buffer for a feedback effect.
   * New buffers are seeded with the current chain input at that slot, so the
   * effect starts from valid history instead of uninitialized memory.
   * Simulation effects (hdrFeedback) get half-float history so their per-frame
   * deltas survive round-tripping.
   */
  private getFxFeedback(
    instanceId: string,
    seedTex: WebGLTexture,
    time: number,
    hdr = false,
  ) {
    let pair = this.fxFeedback.get(instanceId);
    if (!pair) {
      const make = () =>
        hdr
          ? this.createHdrTexture(this.imgW, this.imgH, false)
          : this.createTexture(this.imgW, this.imgH);
      const textures: [WebGLTexture, WebGLTexture] = [make(), make()];
      const fbos = this.createFBOPair(textures);
      pair = { textures, fbos, idx: 0 };
      this.fxFeedback.set(instanceId, pair);
      this.drawPass(this.passthrough, fbos[0], seedTex, 1.0, time);
      this.drawPass(this.passthrough, fbos[1], seedTex, 1.0, time);
    }
    return pair;
  }

  /**
   * For effects with a speed param, accumulate phase so speed changes don't
   * cause jumps. Writes into a shared object rather than returning a fresh one:
   * this runs per effect per frame, and the caller reads it out immediately.
   */
  private getEffectTime(
    eff: EffectInstance,
    time: number,
    dt: number,
  ): { time: number; delta: number } {
    const out = this.effectTimeOut;
    if (!("speed" in eff.values)) {
      out.time = time;
      out.delta = dt;
      return out;
    }
    // Beat-synced: phase is read off the song's grid rather than accumulated,
    // so flashes land on beats and realign after a seek instead of drifting.
    // No BPM (single mode, a track nobody detected) falls back to free-running.
    if (eff.values.sync === "beat" && this.beatPhase !== null) {
      const perBeat = Number(eff.values.division) || 1;
      out.time = this.beatPhase * perBeat;
      out.delta = dt * perBeat * this.beatsPerSecond;
      return out;
    }
    const speed = eff.values.speed as number;
    const prev = this.phaseMap.get(eff.instanceId) ?? 0;
    const phase = prev + dt * speed;
    this.phaseMap.set(eff.instanceId, phase);
    out.time = phase;
    out.delta = dt * speed;
    return out;
  }

  private getTrackingState(instanceId: string): TrackingState {
    let s = this.trackingStates.get(instanceId);
    if (!s) {
      s = {
        boxes: [],
        salPoints: [],
        lastAnalyze: -1,
        lastTick: -1,
        signature: "",
        prevLum: null,
        gridW: 0,
        gridH: 0,
        disturbance: 0,
        primaryKey: -1,
      };
      this.trackingStates.set(instanceId, s);
    }
    return s;
  }

  /** (Re)allocate the small saliency framebuffer to match the current aspect. */
  private ensureSalResources() {
    const gl = this.gl;
    const targetW = 96;
    const targetH = Math.max(
      24,
      Math.min(160, Math.round((targetW * this.imgH) / Math.max(1, this.imgW))),
    );
    if (
      this.salFBO &&
      this.salPBO &&
      this.salW === targetW &&
      this.salH === targetH
    ) {
      return;
    }
    this.abortPendingSaliency();
    if (this.salTexture) gl.deleteTexture(this.salTexture);
    if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
    if (this.salPBO) gl.deleteBuffer(this.salPBO);
    this.salW = targetW;
    this.salH = targetH;
    this.salTexture = this.createTexture(targetW, targetH);
    this.salFBO = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.salFBO);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.salTexture,
      0,
    );
    this.salBuf = new Uint8Array(targetW * targetH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.salPBO = gl.createBuffer()!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.salPBO);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.salBuf.byteLength, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  /** Downsample `srcTex` into the small saliency FBO (leaves it bound). */
  private drawSaliencyPass(srcTex: WebGLTexture) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.salFBO);
    gl.viewport(0, 0, this.salW, this.salH);
    gl.useProgram(this.passthrough.program);
    if (this.passthrough.uniforms["u_flipY"]) {
      gl.uniform1f(this.passthrough.uniforms["u_flipY"], 1.0);
    }
    this.setTextureFilter(srcTex, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    if (this.passthrough.uniforms["u_texture"]) {
      gl.uniform1i(this.passthrough.uniforms["u_texture"], 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.setTextureFilter(srcTex, false);
  }

  /** Score + track from whatever is currently in salBuf. */
  private processSalBuf(
    state: TrackingState,
    params: TrackingParams,
    time: number,
  ) {
    if (!this.salBuf) return;
    const lum = lumFromRGBA(this.salBuf, this.salW * this.salH);
    state.salPoints = computeSaliency(lum, this.salW, this.salH, params);
    trackBoxes(state, params, lum, this.salW, this.salH, time);
  }

  /**
   * Blocking analyze: draw, readPixels, score + track. Only used for the very
   * first analysis (or a time reset) so a single-frame render (still preview,
   * PNG save) gets a populated HUD immediately.
   */
  private analyzeSaliencySync(
    state: TrackingState,
    params: TrackingParams,
    srcTex: WebGLTexture,
    time: number,
  ) {
    const gl = this.gl;
    this.ensureSalResources();
    if (!this.salFBO || !this.salBuf) return;
    this.drawSaliencyPass(srcTex);
    gl.readPixels(
      0,
      0,
      this.salW,
      this.salH,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.salBuf,
    );
    this.processSalBuf(state, params, time);
  }

  /**
   * Kick off a non-blocking readback: readPixels goes into a PBO (no CPU
   * copy, no pipeline stall) and a fence records when the GPU is done.
   * pollSaliency collects the result on a later frame.
   */
  private startSaliencyRead(
    state: TrackingState,
    params: TrackingParams,
    srcTex: WebGLTexture,
    time: number,
  ) {
    const gl = this.gl;
    this.ensureSalResources();
    if (!this.salFBO || !this.salPBO) return;
    this.drawSaliencyPass(srcTex);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.salPBO);
    gl.readPixels(0, 0, this.salW, this.salH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.salFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.salPending = { state, params, time };
  }

  /** Collect a finished async readback, if its fence has signaled. Never stalls. */
  private pollSaliency() {
    const gl = this.gl;
    if (!this.salFence || !this.salPending || !this.salPBO || !this.salBuf) {
      return;
    }
    const status = gl.clientWaitSync(this.salFence, 0, 0);
    if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) {
      return;
    }
    gl.deleteSync(this.salFence);
    this.salFence = null;
    const { state, params, time } = this.salPending;
    this.salPending = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.salPBO);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.salBuf);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.processSalBuf(state, params, time);
  }

  private abortPendingSaliency() {
    if (this.salFence) {
      this.gl.deleteSync(this.salFence);
      this.salFence = null;
    }
    this.salPending = null;
  }

  /** Composite an overlay texture over a main texture into the target FBO. */
  private compositeOverlayToFBO(
    mainTex: WebGLTexture,
    overlayTex: WebGLTexture,
    targetFBO: WebGLFramebuffer,
    opacity: number,
    blendMode: TextOverlayBlendMode = "normal",
  ) {
    const gl = this.gl;
    const prog = this.textBlendProgram;
    if (!prog) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
    gl.viewport(0, 0, this.imgW, this.imgH);
    gl.useProgram(prog.program);
    if (prog.uniforms["u_flipY"]) gl.uniform1f(prog.uniforms["u_flipY"], 1.0);
    if (prog.uniforms["u_blendMode"])
      gl.uniform1i(
        prog.uniforms["u_blendMode"],
        GlRenderer.BLEND_MODE_VALUES[blendMode],
      );
    if (prog.uniforms["u_invert"]) gl.uniform1f(prog.uniforms["u_invert"], 0);
    if (prog.uniforms["u_opacity"])
      gl.uniform1f(prog.uniforms["u_opacity"], opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mainTex);
    if (prog.uniforms["u_texture"]) gl.uniform1i(prog.uniforms["u_texture"], 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, overlayTex);
    if (prog.uniforms["u_texture2"])
      gl.uniform1i(prog.uniforms["u_texture2"], 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Draw each visible text layer and run its own effect chain, so a layer can
   * be moshed without the image underneath it moving. Returns them in the order
   * they were given, ready to be composited into the main chain.
   */
  private prepareTextLayers(
    layers: ResolvedTextLayer[],
    time: number,
    safeDt: number,
  ): PreparedTextLayer[] {
    if (layers.length === 0 || this.imgW <= 0 || this.imgH <= 0) return [];
    const prepared: PreparedTextLayer[] = [];
    for (const layer of layers) {
      const drawn = this.textLayerTexture(layer);
      if (!drawn) continue;
      let tex = drawn;
      if (layer.effects.some((e) => e.enabled)) {
        const buf = this.ensureLayerBuffer(prepared.length);
        if (buf) {
          tex =
            this.renderChainTo(
              layer.effects,
              time,
              safeDt,
              buf.fbo,
              buf.tex,
              false,
              false,
              [],
              drawn,
            ) ?? buf.tex;
        }
      }
      prepared.push({
        tex,
        chainIndex: layer.chainIndex,
        opacity: layer.style.opacity,
        blendMode: layer.style.blendMode,
      });
    }
    return prepared;
  }

  /** The drawn (pre-effect) text for a clip, redrawn only when it changes. */
  private textLayerTexture(layer: ResolvedTextLayer): WebGLTexture | null {
    // Bundled faces load async; the text draws with a fallback until then and
    // is redrawn once fontsVersion() moves.
    void ensureFontLoaded(layer.style.fontFamily);

    return this.upsertOverlayTexture(
      this.textLayerTextures,
      layer.key,
      textSignature(layer.text, layer.style, this.imgW, this.imgH, fontsVersion()),
      (canvas, w, h) => drawTextToCanvas(canvas, w, h, layer.text, layer.style),
      () => (this.textLayerCanvas ??= document.createElement("canvas")),
    );
  }

  /**
   * The cached texture for an overlay, redrawn only when `sig` or the output
   * size changed. Text layers and captions differ solely in what they draw and
   * what they key by, so they share this rather than a copy each.
   */
  private upsertOverlayTexture(
    cache: Map<string, OverlayTexture>,
    key: string,
    sig: string,
    draw: (canvas: HTMLCanvasElement, w: number, h: number) => void,
    canvasFor: () => HTMLCanvasElement,
  ): WebGLTexture {
    const gl = this.gl;
    const w = this.imgW;
    const h = this.imgH;
    let entry = cache.get(key);
    if (entry && (entry.w !== w || entry.h !== h)) {
      gl.deleteTexture(entry.tex);
      cache.delete(key);
      entry = undefined;
    }
    if (entry && entry.sig === sig) return entry.tex;

    const canvas = canvasFor();
    draw(canvas, w, h);
    if (!entry) {
      const tex = this.createTexture(w, h);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      entry = { tex, w, h, sig };
      cache.set(key, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    entry.sig = sig;
    return entry.tex;
  }

  private ensureLayerBuffer(
    index: number,
  ): { tex: WebGLTexture; fbo: WebGLFramebuffer } | null {
    const existing = this.layerBuffers[index];
    if (existing) return existing;
    const tex = this.createTexture(this.imgW, this.imgH);
    const fbo = this.createRenderTarget(tex);
    if (!fbo) return null;
    const buf = { tex, fbo };
    this.layerBuffers[index] = buf;
    return buf;
  }

  /** Drop drawn text for clips that are no longer on screen. */
  private gcTextLayers(layers: ResolvedTextLayer[]) {
    if (this.textLayerTextures.size === 0) return;
    const live = new Set(layers.map((l) => l.key));
    for (const [key, entry] of this.textLayerTextures) {
      if (!live.has(key)) {
        this.gl.deleteTexture(entry.tex);
        this.textLayerTextures.delete(key);
      }
    }
  }

  private deleteLayerBuffers() {
    const gl = this.gl;
    for (const buf of this.layerBuffers) {
      gl.deleteTexture(buf.tex);
      gl.deleteFramebuffer(buf.fbo);
    }
    this.layerBuffers = [];
  }

  private clearTextLayerTextures() {
    for (const entry of this.textLayerTextures.values()) {
      this.gl.deleteTexture(entry.tex);
    }
    this.textLayerTextures.clear();
  }

  /** Draw a caption and composite it over `inputTex` into `targetFBO`. */
  private renderCaption(
    eff: EffectInstance,
    inputTex: WebGLTexture,
    targetFBO: WebGLFramebuffer,
  ) {
    if (this.imgW <= 0 || this.imgH <= 0) return;
    const params = readCaptionParams(eff.values);
    if (!params.text.trim() || params.opacity <= 0) {
      this.drawPass(this.passthrough, targetFBO, inputTex, 1.0, 0);
      return;
    }
    // Bundled faces load async; the caption draws with a fallback until then and
    // is redrawn once fontsVersion() moves.
    void ensureFontLoaded(params.fontFamily);

    const tex = this.upsertOverlayTexture(
      this.captionTextures,
      eff.instanceId,
      captionSignature(params, this.imgW, this.imgH, fontsVersion()),
      (canvas, w, h) => drawCaptionToCanvas(canvas, w, h, params),
      () => (this.captionCanvas ??= document.createElement("canvas")),
    );

    this.compositeOverlayToFBO(
      inputTex,
      tex,
      targetFBO,
      params.opacity,
      params.blendMode,
    );
  }

  /** Build the tracking HUD and composite it over `inputTex` into `targetFBO`. */
  private renderTracking(
    eff: EffectInstance,
    inputTex: WebGLTexture,
    targetFBO: WebGLFramebuffer,
    time: number,
  ) {
    if (this.imgW <= 0 || this.imgH <= 0) return;
    const params = readTrackingParams(eff.values);
    const state = this.getTrackingState(eff.instanceId);

    // Re-analyze on a fixed cadence in animation-time so preview and export
    // stay deterministic. 0.12 s ≈ 8 Hz: fluid motion, cheap 96-px readback.
    // Reads the chain output feeding this pass, so boxes chase content set in
    // motion by upstream effects (and video motion).
    const interval = 0.12;
    if (state.lastAnalyze < 0 || time < state.lastAnalyze) {
      // First frame or time reset: blocking analyze so a single-frame render
      // shows a populated HUD.
      this.abortPendingSaliency();
      this.analyzeSaliencySync(state, params, inputTex, time);
      state.lastAnalyze = time;
    } else {
      // Steady state: collect the previous async readback once its fence
      // signals, then start the next one on cadence. The ~1-frame latency is
      // invisible at 8 Hz and avoids readPixels' full GPU pipeline stall.
      this.pollSaliency();
      if (time - state.lastAnalyze >= interval && !this.salFence) {
        this.startSaliencyRead(state, params, inputTex, time);
        state.lastAnalyze = time;
      }
    }
    syncBoxes(state, params, time);
    const trackingW = Math.max(1, Math.round(this.imgW * 0.5));
    const trackingH = Math.max(1, Math.round(this.imgH * 0.5));
    const frame = resolveFrame(state, params, time, trackingW, trackingH);

    // The 2D-canvas redraw + texture upload is the expensive part of this
    // overlay. Render at half resolution (still plenty for thin HUD strokes)
    // and skip both when the HUD would be pixel-identical.
    const gl = this.gl;
    const sig =
      eff.instanceId +
      "|" +
      trackingFrameSignature(frame, params, time, trackingW, trackingH);
    const texValid =
      this.trackingTexture !== null &&
      this.trackingTexW === trackingW &&
      this.trackingTexH === trackingH;
    if (!texValid || sig !== this.lastTrackingSig) {
      if (!this.trackingCanvas) {
        this.trackingCanvas = document.createElement("canvas");
      }
      drawTrackingToCanvas(
        this.trackingCanvas,
        trackingW,
        trackingH,
        frame,
        params,
        time,
      );
      if (!texValid) {
        if (this.trackingTexture) gl.deleteTexture(this.trackingTexture);
        this.trackingTexture = this.createTexture(trackingW, trackingH);
        gl.bindTexture(gl.TEXTURE_2D, this.trackingTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.trackingTexW = trackingW;
        this.trackingTexH = trackingH;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.trackingTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.trackingCanvas,
      );
      this.lastTrackingSig = sig;
    }

    this.compositeOverlayToFBO(
      inputTex,
      this.trackingTexture!,
      targetFBO,
      params.opacity,
    );
  }

  destroy() {
    const gl = this.gl;
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    if (this.trackingTexture) gl.deleteTexture(this.trackingTexture);
    this.trackingTexture = null;
    this.clearCaptionTextures();
    this.clearTextLayerTextures();
    this.deleteLayerBuffers();
    this.abortPendingSaliency();
    if (this.salTexture) gl.deleteTexture(this.salTexture);
    this.salTexture = null;
    if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
    this.salFBO = null;
    if (this.salPBO) gl.deleteBuffer(this.salPBO);
    this.salPBO = null;
    this.trackingStates.clear();
    if (this.textBlendProgram) gl.deleteProgram(this.textBlendProgram.program);
    this.textBlendProgram = null;
    if (this.altSourceTexture) gl.deleteTexture(this.altSourceTexture);
    this.altSourceTexture = null;
    this.deleteStageBuffer();
    this.deleteTexturePair(this.ppTextures);
    this.deleteFBOPair(this.ppFBOs);
    if (this.fbTexture) gl.deleteTexture(this.fbTexture);
    if (this.fbFBO) gl.deleteFramebuffer(this.fbFBO);
    this.deleteTexturePair(this.hdrTextures);
    this.deleteFBOPair(this.hdrFBOs);
    this.deleteTexturePair(this.sceneTextures);
    this.deleteFBOPair(this.sceneFBOs);
    if (this.blendTexture) gl.deleteTexture(this.blendTexture);
    if (this.blendFBO) gl.deleteFramebuffer(this.blendFBO);
    this.deleteStackBuffers();
    for (const prog of this.transitionPrograms.values()) {
      gl.deleteProgram(prog.program);
    }
    this.transitionPrograms.clear();
    gl.deleteProgram(this.passthrough.program);
    for (const pair of this.fxFeedback.values()) {
      this.deleteTexturePair(pair.textures);
      this.deleteFBOPair(pair.fbos);
    }
    this.fxFeedback.clear();
    for (const tex of this.glyphTextures.values()) gl.deleteTexture(tex);
    this.glyphTextures.clear();
    if (this.spectrumTexture) gl.deleteTexture(this.spectrumTexture);
    this.spectrumTexture = null;
    for (const entry of this.compiled.values()) {
      gl.deleteProgram(entry.program.program);
      if (entry.prePasses) {
        for (const pp of entry.prePasses) gl.deleteProgram(pp.program.program);
      }
    }
    gl.deleteVertexArray(this.quadVAO);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** One texel per FFT bin, R8. Rewritten per audio-bars instance as the chain
   * is walked, so each can follow the audio with its own Smoothing. */
  private spectrumTexture: WebGLTexture | null = null;
  private spectrumW = 0;
  private spectrumTime = -1;
  /** This frame's normalized bins, held until the chain walk consumes them. */
  private spectrumFrame: Uint8Array | null = null;
  private spectrumDt = 0;
  /** Bumped once per setSpectrum, so a chain walked twice in one frame (a
   * transition blend, stacked lanes) doesn't step the followers twice. */
  private spectrumSerial = 0;
  private spectrumSmoothed = new Map<
    string,
    { buf: Uint8Array; serial: number }
  >();
  private static readonly SILENCE = new Uint8Array(1);

  /**
   * Hand the renderer this frame's FFT bins.
   *
   * Both drivers call it and must keep calling it: the preview passes the
   * AnalyserNode's live array, the exporter passes the frame's offline FFT. If
   * only one did, a visualizer would preview and export differently. Null (no
   * track loaded, or a frame before the audio starts) uploads silence, so the
   * bars collapse instead of freezing on the last thing they saw.
   *
   * Normalization happens here because it describes the signal and every
   * instance wants the same answer. Smoothing does not: it is a parameter on
   * the effect, so it is applied per instance in `uploadSpectrumFor`.
   */
  /** Beat position of the frame being rendered, or null when no BPM is known. */
  private beatPhase: number | null = null;
  private beatsPerSecond = 0;

  /**
   * Hand the renderer this frame's place on the song's beat grid, in beats
   * from the grid's origin. Like `setSpectrum`, both drivers must keep calling
   * it or a beat-synced effect would preview and export differently.
   */
  setBeat(beats: number | null, beatsPerSecond = 0): void {
    this.beatPhase = beats;
    this.beatsPerSecond = beatsPerSecond;
  }

  setSpectrum(data: Uint8Array | null, time: number): void {
    // Its own clock, not frameDelta's: that one is consumed by render() and
    // reading it here would leave the effect chain with a zero delta.
    const raw = this.spectrumTime >= 0 ? time - this.spectrumTime : 0;
    this.spectrumTime = time;
    this.spectrumDt = raw > 0 && raw < 0.5 ? raw : 0;
    this.spectrumFrame = normalizeSpectrum(data, this.spectrumDt);
    this.spectrumSerial++;
    this.uploadSpectrumTexture(this.spectrumFrame);
  }

  /** Re-point the shared texture at `data`, resizing it if the bin count moved. */
  private uploadSpectrumTexture(data: Uint8Array | null): void {
    const gl = this.gl;
    const payload =
      data && data.length > 0 ? data : (GlRenderer.SILENCE as Uint8Array);
    const width = payload.length;
    if (!this.spectrumTexture || this.spectrumW !== width) {
      if (this.spectrumTexture) gl.deleteTexture(this.spectrumTexture);
      this.spectrumTexture = gl.createTexture()!;
      this.spectrumW = width;
      gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, 1);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
    }
    // A single row of bytes: the default 4-byte row alignment would misread
    // any bin count that isn't a multiple of four.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      width,
      1,
      gl.RED,
      gl.UNSIGNED_BYTE,
      payload as Uint8Array<ArrayBuffer>,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /**
   * Put this instance's own envelope-followed copy of the frame on the texture,
   * right before it draws. Two Audio Bars at different Smoothing settings each
   * get their own follower off the same audio.
   */
  private uploadSpectrumFor(eff: EffectInstance): void {
    const frame = this.spectrumFrame;
    if (!frame || frame.length === 0) return;
    const smoothing =
      typeof eff.values.smoothing === "number"
        ? eff.values.smoothing
        : DEFAULT_AUDIO_RESPONSE.smoothing;
    let entry = this.spectrumSmoothed.get(eff.instanceId);
    if (!entry || entry.buf.length !== frame.length) {
      entry = { buf: new Uint8Array(frame.length), serial: -1 };
      this.spectrumSmoothed.set(eff.instanceId, entry);
    }
    if (entry.serial !== this.spectrumSerial) {
      entry.serial = this.spectrumSerial;
      smoothSpectrum(
        eff.instanceId,
        frame,
        entry.buf,
        this.spectrumDt,
        smoothing,
      );
    }
    // Re-uploaded even when the follower didn't step: another instance may have
    // left its own buffer on the texture since.
    this.uploadSpectrumTexture(entry.buf);
  }


  /**
   * ASCII glyph atlases, one per charset, shared by the ascii effect. Each is a
   * single row of {@link ASCII_GLYPH_CELL}-sized cells: the charset's glyphs
   * sorted by the ink they actually rasterize to, then four edge strokes the
   * shader selects by Sobel orientation.
   */
  private glyphTextures = new Map<string, WebGLTexture>();

  /** Measured ink coverage per character, keyed by the character. */
  private inkCoverage = new Map<string, number>();

  private static readonly GLYPH_FONT = `500 ${Math.round(
    ASCII_GLYPH_CELL.h * 0.78,
  )}px "Consolas", "Lucida Console", "Menlo", monospace`;

  /**
   * How much of a cell a character fills once rasterized.
   *
   * Hand-ordered ramps like " .-:;i+r*oX#%&$@" only look monotonic — in the
   * actual font at the actual size, `i` and `+` and `r` don't step evenly, so
   * the ramp has flat spots and reversals that read as noise. Measuring lets
   * every charset be a pool the atlas sorts for itself.
   */
  private measureInk(ch: string): number {
    const cached = this.inkCoverage.get(ch);
    if (cached !== undefined) return cached;
    const { w, h } = ASCII_GLYPH_CELL;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = GlRenderer.GLYPH_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ch, w / 2, h / 2);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i];
    const coverage = sum / (w * h * 255);
    this.inkCoverage.set(ch, coverage);
    return coverage;
  }

  /**
   * The four orientation glyphs, in the bin order the shader expects: 0°
   * horizontal, 45°, 90° vertical, 135°.
   *
   * UV space runs y-down (nothing flips on upload), so the shader's 45° bin
   * is the diagonal that descends to the right — a visual \ — and 135° is
   * the one that rises. Swapping these two makes every contour draw across its
   * own edge instead of along it.
   *
   * Drawn as strokes rather than the font's -, /, | and \ so they run edge to
   * edge: a contour crossing several cells joins up instead of breaking at
   * every glyph's side bearing. In a 1:2 cell corner-to-corner is steeper than
   * 45°, which is exactly how a slash reads in a monospace font.
   */
  private drawEdgeStrokes(ctx: CanvasRenderingContext2D, x0: number) {
    const { w, h } = ASCII_GLYPH_CELL;
    const strokes: [number, number, number, number][] = [
      [0, h / 2, w, h / 2],
      [0, 0, w, h],
      [w / 2, 0, w / 2, h],
      [0, h, w, 0],
    ];
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, w * 0.16);
    strokes.forEach(([ax, ay, bx, by], i) => {
      ctx.beginPath();
      ctx.moveTo(x0 + i * w + ax, ay);
      ctx.lineTo(x0 + i * w + bx, by);
      ctx.stroke();
    });
    ctx.restore();
  }

  private buildGlyphAtlas(chars: string): WebGLTexture {
    const { w, h } = ASCII_GLYPH_CELL;
    const glyphs = [...chars].sort((a, b) => this.measureInk(a) - this.measureInk(b));
    const canvas = document.createElement("canvas");
    canvas.width = w * (glyphs.length + 4);
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = GlRenderer.GLYPH_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Natural proportions in a 1:2 cell. The old atlas stretched every glyph
    // 1.9x wide to fill a square cell, which stopped them reading as characters.
    for (let i = 0; i < glyphs.length; i++) {
      ctx.fillText(glyphs[i], i * w + w / 2, h / 2);
    }
    this.drawEdgeStrokes(ctx, glyphs.length * w);

    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Mipmapped: without mips, small cell sizes undersample glyphs and produce
    // dark-square moire patches. The shader picks the level explicitly.
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  private createQuad(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // prettier-ignore
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Left bound: every draw in this class uses this one quad, and nothing else
    // ever binds a VAO on this context, so re-binding per pass was pure churn.
    return vao;
  }

  private compile(fragSource: string): CompiledProgram {
    const gl = this.gl;
    const program = createProgram(gl, VERTEX_SHADER, fragSource);
    const uniforms = getUniformLocations(gl, program);
    return { program, uniforms };
  }

  private compileAllEffects() {
    for (const [id, def] of Object.entries(EFFECT_SHADERS)) {
      try {
        const program = this.compile(def.fragment);
        let prePasses:
          | { program: CompiledProgram; linearFilter?: boolean }[]
          | undefined;
        if (def.prePasses) {
          prePasses = def.prePasses.map((pp) => ({
            program: this.compile(pp.fragment),
            linearFilter: pp.linearFilter,
          }));
        }
        this.compiled.set(id, { program, def, prePasses });
      } catch (e) {
        console.error(`Failed to compile effect "${id}":`, e);
      }
    }
  }

  private createTexture(width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    return tex;
  }

  private createHdrTexture(
    width: number,
    height: number,
    linear = true,
  ): WebGLTexture {
    const gl = this.gl;
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      width,
      height,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null,
    );
    return tex;
  }

  private deleteTexturePair(pair: [WebGLTexture, WebGLTexture] | null) {
    if (pair) {
      this.gl.deleteTexture(pair[0]);
      this.gl.deleteTexture(pair[1]);
    }
  }

  private deleteFBOPair(pair: [WebGLFramebuffer, WebGLFramebuffer] | null) {
    if (pair) {
      this.gl.deleteFramebuffer(pair[0]);
      this.gl.deleteFramebuffer(pair[1]);
    }
  }

  /**
   * An FBO rendering into `tex`. Null only when the context refuses to make one
   * at all; an *incomplete* one is still returned, because that is what every
   * call site here did before and the draws against it fail harmlessly (a black
   * pass) rather than taking the editor down. It gets reported once per status,
   * which is the whole point — a half-float target the driver won't accept used
   * to show up only as bloom that silently does nothing.
   */
  private createRenderTarget(tex: WebGLTexture): WebGLFramebuffer | null {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    if (!fbo) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE && !reportedFBOStatuses.has(status)) {
      reportedFBOStatuses.add(status);
      console.error(`Incomplete framebuffer (status 0x${status.toString(16)})`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  private createFBOPair(
    textures: [WebGLTexture, WebGLTexture],
  ): [WebGLFramebuffer, WebGLFramebuffer] {
    return [
      this.createRenderTarget(textures[0])!,
      this.createRenderTarget(textures[1])!,
    ];
  }

  private setupPingPong() {
    const gl = this.gl;
    // Sized from imgW/imgH, which this call is the signal changed.
    this.deleteStageBuffer();
    this.deleteTexturePair(this.ppTextures);
    this.deleteFBOPair(this.ppFBOs);
    this.ppTextures = [
      this.createTexture(this.imgW, this.imgH),
      this.createTexture(this.imgW, this.imgH),
    ];
    this.ppFBOs = this.createFBOPair(this.ppTextures);

    this.deleteLazyBuffers();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const pair of this.fxFeedback.values()) {
      this.deleteTexturePair(pair.textures);
      this.deleteFBOPair(pair.fbos);
    }
    this.fxFeedback.clear();
  }

  private deleteLazyBuffers() {
    const gl = this.gl;
    if (this.fbTexture) {
      gl.deleteTexture(this.fbTexture);
      this.fbTexture = null;
    }
    if (this.fbFBO) {
      gl.deleteFramebuffer(this.fbFBO);
      this.fbFBO = null;
    }
    this.deleteTexturePair(this.hdrTextures);
    this.deleteFBOPair(this.hdrFBOs);
    this.hdrTextures = null;
    this.hdrFBOs = null;
    this.hdrW = 0;
    this.hdrH = 0;
    this.deleteTexturePair(this.sceneTextures);
    this.deleteFBOPair(this.sceneFBOs);
    this.sceneTextures = null;
    this.sceneFBOs = null;
    if (this.blendTexture) {
      gl.deleteTexture(this.blendTexture);
      this.blendTexture = null;
    }
    if (this.blendFBO) {
      gl.deleteFramebuffer(this.blendFBO);
      this.blendFBO = null;
    }
    this.deleteStackBuffers();
    if (this.trackingTexture) {
      gl.deleteTexture(this.trackingTexture);
      this.trackingTexture = null;
    }
    this.trackingTexW = 0;
    this.trackingTexH = 0;
    this.lastTrackingSig = "";
    this.clearCaptionTextures();
    this.clearTextLayerTextures();
    this.deleteLayerBuffers();
    this.abortPendingSaliency();
    if (this.salTexture) gl.deleteTexture(this.salTexture);
    if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
    if (this.salPBO) gl.deleteBuffer(this.salPBO);
    this.salTexture = null;
    this.salFBO = null;
    this.salPBO = null;
    this.salW = 0;
    this.salH = 0;
  }

  private ensureHdrBuffers() {
    const expectedW = Math.max(1, Math.round(this.imgW / 2));
    const expectedH = Math.max(1, Math.round(this.imgH / 2));
    if (
      this.hdrTextures &&
      this.hdrFBOs &&
      this.hdrW === expectedW &&
      this.hdrH === expectedH
    ) {
      return;
    }
    this.deleteTexturePair(this.hdrTextures);
    this.deleteFBOPair(this.hdrFBOs);
    this.hdrW = expectedW;
    this.hdrH = expectedH;
    this.hdrTextures = [
      this.createHdrTexture(this.hdrW, this.hdrH),
      this.createHdrTexture(this.hdrW, this.hdrH),
    ];
    this.hdrFBOs = this.createFBOPair(this.hdrTextures);
  }

  private ensureSceneBuffers() {
    if (this.sceneTextures && this.sceneFBOs) return;
    this.sceneTextures = [
      this.createTexture(this.imgW, this.imgH),
      this.createTexture(this.imgW, this.imgH),
    ];
    this.sceneFBOs = this.createFBOPair(this.sceneTextures);
  }

  /**
   * Run the stacked fx lanes over `inputTex`, in lane order, and return the
   * texture holding the result.
   *
   * A full-strength lane just chains off the previous result. A fading one
   * renders its chain, then mixes that output back over its own input at the
   * lane's weight — so the lane arrives and leaves gradually without any of its
   * effects needing to know what "half applied" means for their parameters.
   */
  private renderStack(
    layers: PostChainLayer[],
    inputTex: WebGLTexture,
    time: number,
    safeDt: number,
  ): WebGLTexture {
    this.ensureStackBuffers();
    let cur = inputTex;
    // Index of the buffer `cur` lives in, or -1 while it's still the caller's
    // texture — which must never be written to.
    let curIdx = -1;

    for (const layer of layers) {
      const outIdx = this.freeStackIndex(curIdx, -1);
      const outTex = this.renderChainTo(
        layer.effects,
        time,
        safeDt,
        this.stackFBOs![outIdx],
        this.stackTextures![outIdx],
        false,
        false,
        [],
        cur,
      )!;

      if (layer.weight >= 1) {
        cur = outTex;
        // renderChainTo can hand back a private feedback texture rather than
        // the buffer we named, so track where the result actually is.
        curIdx = outTex === this.stackTextures![outIdx] ? outIdx : -1;
        continue;
      }

      const mixIdx = this.freeStackIndex(curIdx, outIdx);
      this.compositeOverlayToFBO(
        cur,
        outTex,
        this.stackFBOs![mixIdx],
        layer.weight,
        "normal",
      );
      cur = this.stackTextures![mixIdx];
      curIdx = mixIdx;
    }
    return cur;
  }

  /** A stack buffer that is neither of the two given ones. */
  private freeStackIndex(a: number, b: number): number {
    for (let i = 0; i < 3; i++) {
      if (i !== a && i !== b) return i;
    }
    return 0;
  }

  private ensureStackBuffers() {
    if (this.stackTextures && this.stackFBOs) return;
    this.stackTextures = [];
    this.stackFBOs = [];
    for (let i = 0; i < 3; i++) {
      const tex = this.createTexture(this.imgW, this.imgH);
      this.stackTextures.push(tex);
      this.stackFBOs.push(this.createRenderTarget(tex)!);
    }
  }

  private deleteStackBuffers() {
    const gl = this.gl;
    for (const tex of this.stackTextures ?? []) gl.deleteTexture(tex);
    for (const fbo of this.stackFBOs ?? []) gl.deleteFramebuffer(fbo);
    this.stackTextures = null;
    this.stackFBOs = null;
  }

  /** Lazy: only a blend with a chain stacked over it ever needs this. */
  private ensureBlendBuffer() {
    if (this.blendTexture && this.blendFBO) return;
    this.blendTexture = this.createTexture(this.imgW, this.imgH);
    this.blendFBO = this.createRenderTarget(this.blendTexture);
  }

  private ensurePresentBuffer() {
    if (this.fbTexture && this.fbFBO) return;
    this.fbTexture = this.createTexture(this.imgW, this.imgH);
    this.fbFBO = this.createRenderTarget(this.fbTexture);
  }

  private static BLEND_MODE_VALUES: Record<TextOverlayBlendMode, number> = {
    normal: 0,
    multiply: 1,
    add: 2,
    screen: 3,
    overlay: 4,
    difference: 5,
    exclusion: 6,
    subtract: 7,
  };

  /** Toggle texture filtering between LINEAR and NEAREST. */
  private setTextureFilter(tex: WebGLTexture, linear: boolean) {
    const gl = this.gl;
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  }

  private drawPass(
    compiled: CompiledProgram,
    fbo: WebGLFramebuffer | null,
    inputTex: WebGLTexture,
    flipY: number,
    time: number,
    shaderDef?: EffectShaderDef,
    values?: Record<string, number | string>,
    originalTex?: WebGLTexture,
    delta?: number,
    feedbackTex?: WebGLTexture,
    vpW?: number,
    vpH?: number,
  ) {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    if (fbo) {
      // vpW/vpH override for off-size render targets (half-res HDR pre-passes)
      gl.viewport(0, 0, vpW ?? this.imgW, vpH ?? this.imgH);
    } else {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    gl.useProgram(compiled.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    if (compiled.uniforms["u_texture"]) {
      gl.uniform1i(compiled.uniforms["u_texture"], 0);
    }
    if (compiled.uniforms["u_flipY"]) {
      gl.uniform1f(compiled.uniforms["u_flipY"], flipY);
    }
    if (compiled.uniforms["u_resolution"]) {
      gl.uniform2f(compiled.uniforms["u_resolution"], this.imgW, this.imgH);
    }
    if (compiled.uniforms["u_time"]) {
      gl.uniform1f(compiled.uniforms["u_time"], time);
    }
    if (compiled.uniforms["u_delta"] && delta !== undefined) {
      gl.uniform1f(compiled.uniforms["u_delta"], delta);
    }
    if (compiled.uniforms["u_feedback"] && this.fbTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(
        gl.TEXTURE_2D,
        feedbackTex ?? this.fbTexture,
      );
      gl.uniform1i(compiled.uniforms["u_feedback"], 1);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (originalTex && compiled.uniforms["u_original"]) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, originalTex);
      gl.uniform1i(compiled.uniforms["u_original"], 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (compiled.uniforms["u_spectrum"]) {
      // Never leave the sampler at its default unit 0 — it would read the
      // frame itself as a spectrum and paint noise.
      if (!this.spectrumTexture) this.uploadSpectrumTexture(null);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
      gl.uniform1i(compiled.uniforms["u_spectrum"], 5);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (compiled.uniforms["u_glyphs"]) {
      const charset = (values?.charset as string) || "classic";
      const glyphTex =
        this.glyphTextures.get(charset) ?? this.glyphTextures.get("classic");
      if (glyphTex) {
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, glyphTex);
        gl.uniform1i(compiled.uniforms["u_glyphs"], 4);
        gl.activeTexture(gl.TEXTURE0);
      }
    }

    if (shaderDef && values) {
      shaderDef.setUniforms(gl, compiled.uniforms, values);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
