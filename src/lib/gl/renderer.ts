import type { EffectInstance } from "../effects";
import { ASCII_CHARSETS } from "../effects/definitions";
import { drawPhraseToCanvas } from "../text-overlay";
import type { TextOverlayStyle } from "../text-overlay";
import type { DrawPhraseOptions } from "../text-overlay";
import { createProgram, getUniformLocations } from "./utils";
import {
  VERTEX_SHADER,
  PASSTHROUGH_FRAG,
  TEXT_BLEND_FRAG,
  EFFECT_SHADERS,
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

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation>;
}

export class GlRenderer {
  private gl: WebGL2RenderingContext;
  private quadVAO: WebGLVertexArrayObject;
  private sourceTexture: WebGLTexture | null = null;
  /** Allocated dimensions of sourceTexture, so per-frame uploads can take the
   * texSubImage2D fast path when the size is unchanged and only reallocate on
   * an actual size change (mixed-size slideshow slides). */
  private srcTexW = 0;
  private srcTexH = 0;
  private ppTextures: [WebGLTexture, WebGLTexture] | null = null;
  private ppFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private fbTextures: [WebGLTexture, WebGLTexture] | null = null;
  private fbFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
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
  private transitionPrograms = new Map<string, CompiledProgram>();
  private fbIdx = 0;
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
  private textTexture: WebGLTexture | null = null;
  private textBlendProgram: CompiledProgram | null = null;
  /** Current overlay phrase; null = no overlay. */
  private textOverlayPhrase: string | null = null;
  private textBlendMode: TextOverlayBlendMode = "normal";
  private textInvert = false;
  private textOpacity = 1;
  /** Cache for setTextOverlay: skip redraw when phrase/seed/layout/style/dims unchanged. */
  private lastTextPhrase: string | null = null;
  private lastTextSeed: number | null = null;
  private lastTextLayout: string | null = null;
  private lastTextStyleRef: TextOverlayStyle | null = null;
  private lastTextW = 0;
  private lastTextH = 0;
  private imgW = 0;
  private imgH = 0;
  private lastTime = -1;
  private phaseMap = new Map<string, number>();

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
   * Pre-compile all shaders on a hidden 1×1 canvas so the first real render
   * doesn't pay the compilation cost. Returns the warmed renderer + its canvas;
   * pass both into GlCanvas via the `warmCanvas`/`warmRenderer` props.
   */
  static warmup(): { canvas: HTMLCanvasElement; renderer: GlRenderer } {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none";
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
    const gl = this.gl;
    const naturalW = image.naturalWidth;
    const naturalH = image.naturalHeight;
    this.imgW = naturalW;
    this.imgH = naturalH;
    if (this.canvas.width !== naturalW) this.canvas.width = naturalW;
    if (this.canvas.height !== naturalH) this.canvas.height = naturalH;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = this.createTexture(naturalW, naturalH);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.srcTexW = naturalW;
    this.srcTexH = naturalH;

    this.setupPingPong();
  }

  loadVideo(video: HTMLVideoElement) {
    const gl = this.gl;
    const w = video.videoWidth;
    const h = video.videoHeight;
    // A 0×0 source texture makes every subsequent draw fail, freezing the
    // preview on the last presented frame (preserveDrawingBuffer)
    if (w === 0 || h === 0) return;
    this.imgW = w;
    this.imgH = h;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = this.createTexture(w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.srcTexW = w;
    this.srcTexH = h;

    this.setupPingPong();
  }

  /**
   * Allocate the source texture/FBOs for externally-decoded VideoFrames
   * (WebCodecs preview) — like loadVideo, but without an element to sample.
   */
  initVideoSource(w: number, h: number) {
    if (w === 0 || h === 0) return;
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

  /** Set text overlay for the next render. Pass null to clear. options: layout, seed, blendMode, invert. */
  setTextOverlay(
    phrase: string | null,
    style?: TextOverlayStyle | null,
    options?: DrawPhraseOptions & {
      blendMode?: TextOverlayBlendMode;
      invert?: boolean;
      opacity?: number;
    },
  ) {
    this.textOverlayPhrase = phrase;
    this.textBlendMode = options?.blendMode ?? "normal";
    this.textInvert = options?.invert ?? false;
    this.textOpacity = options?.opacity ?? 1;
    if (!phrase || !style) return;
    if (this.imgW <= 0 || this.imgH <= 0) return;
    const layout = options?.layout ?? "block";
    const seed = options?.layout === "scattered" ? (options?.seed ?? 0) : 0;
    // Identity compare: both callers pass a stable style reference (a $derived
    // in preview, a build-once object in export), so this skips redraws
    // without stringifying the style object every frame.
    if (
      this.lastTextPhrase === phrase &&
      this.lastTextSeed === seed &&
      this.lastTextLayout === layout &&
      this.lastTextStyleRef === style &&
      this.lastTextW === this.imgW &&
      this.lastTextH === this.imgH
    ) {
      return; // reuse existing text texture
    }
    this.lastTextPhrase = phrase;
    this.lastTextSeed = seed;
    this.lastTextLayout = layout;
    this.lastTextStyleRef = style;
    this.lastTextW = this.imgW;
    this.lastTextH = this.imgH;
    const drawOptions: DrawPhraseOptions = {
      layout,
      seed: options?.layout === "scattered" ? (options?.seed ?? 0) : undefined,
    };
    const textCanvas = drawPhraseToCanvas(
      phrase,
      this.imgW,
      this.imgH,
      style,
      drawOptions,
    );
    const gl = this.gl;
    if (!this.textTexture) {
      this.textTexture = this.createTexture(this.imgW, this.imgH);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      textCanvas,
    );
  }

  /** Clear text overlay (e.g. after recording). */
  clearTextOverlay() {
    this.textOverlayPhrase = null;
    this.lastTextSeed = null;
    this.lastTextLayout = null;
    this.lastTextStyleRef = null;
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

  render(effects: EffectInstance[], time = 0) {
    if (
      !this.sourceTexture ||
      !this.ppTextures ||
      !this.ppFBOs ||
      !this.fbTextures ||
      !this.fbFBOs
    )
      return;

    this.gcFxFeedback(new Set(effects.map((e) => e.instanceId)));
    const safeDt = this.frameDelta(time);
    const writeIdx = (1 - this.fbIdx) as 0 | 1;
    const resultTex = this.renderChainTo(
      effects,
      time,
      safeDt,
      this.fbFBOs[writeIdx],
      this.fbTextures[writeIdx],
    );
    this.presentFrame(resultTex, writeIdx);
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
  ) {
    if (
      !this.sourceTexture ||
      !this.ppTextures ||
      !this.ppFBOs ||
      !this.fbTextures ||
      !this.fbFBOs ||
      !this.sceneTextures ||
      !this.sceneFBOs
    )
      return;
    const prog = this.transitionPrograms.get(type);
    if (!prog || progress >= 1) {
      this.render(effectsB, time);
      return;
    }

    // Both chains stay alive for the whole blend — collect feedback buffers
    // only against the union, or rendering A would drop B's history.
    const live = new Set<string>();
    for (const e of effectsA) live.add(e.instanceId);
    for (const e of effectsB) live.add(e.instanceId);
    this.gcFxFeedback(live);
    const safeDt = this.frameDelta(time);

    const texA = this.renderChainTo(
      effectsA,
      time,
      safeDt,
      this.sceneFBOs[0],
      this.sceneTextures[0],
    );
    const texB = this.renderChainTo(
      effectsB,
      time,
      safeDt,
      this.sceneFBOs[1],
      this.sceneTextures[1],
    );

    const writeIdx = (1 - this.fbIdx) as 0 | 1;
    this.drawTransitionPass(
      prog,
      this.fbFBOs[writeIdx],
      texA,
      texB,
      progress,
      seed,
      direction,
      density,
      time,
    );
    this.presentFrame(this.fbTextures[writeIdx]!, writeIdx);
  }

  /** Per-frame delta time for phase accumulation, guarded against discontinuities. */
  private frameDelta(time: number): number {
    const dt = this.lastTime >= 0 ? time - this.lastTime : 0;
    this.lastTime = time;
    // Guard against time discontinuities (e.g. switching between recording and real-time)
    return dt > 0 && dt < 0.5 ? dt : 0;
  }

  /** Drop per-instance state for effects that no longer exist (deleted, or
   * replaced wholesale by undo/preset): feedback GPU buffers, plus the phase
   * and tracking maps. Every mosh roll mints fresh instanceIds, so without this
   * the latter two grow unbounded across a long session. */
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
    for (const id of this.trackingStates.keys()) {
      if (!live.has(id)) this.trackingStates.delete(id);
    }
  }

  /**
   * Render one effect chain, writing the final pass into `finalFbo` and
   * returning the texture holding the result (a private feedback buffer when
   * the last effect reads u_feedback). Intermediate passes share the
   * ping-pong FBOs, so chains must run sequentially.
   */
  private renderChainTo(
    effects: EffectInstance[],
    time: number,
    safeDt: number,
    finalFbo: WebGLFramebuffer,
    finalTex: WebGLTexture,
  ): WebGLTexture {
    const enabled = effects.filter((e) => e.enabled);

    if (enabled.length === 0) {
      this.drawPass(
        this.passthrough,
        finalFbo,
        this.sourceTexture!,
        1.0,
        time,
      );
      return finalTex;
    }

    let input = this.sourceTexture!;
    let ppIdx = 0;
    /** Texture holding the final chain output (presented at the end). */
    let resultTex: WebGLTexture | null = null;

    for (let i = 0; i < enabled.length; i++) {
      const eff = enabled[i];
      const isLast = i === enabled.length - 1;

      // Tracking is a CPU-built 2D overlay, not a shader pass. Composite it over
      // the current chain input at this slot, so later effects can distort it.
      if (eff.defId === TRACKING_EFFECT_ID) {
        const target = isLast ? finalFbo : this.ppFBOs![ppIdx];
        this.renderTracking(eff, input, target, time);
        if (isLast) {
          resultTex = finalTex;
        } else {
          input = this.ppTextures![ppIdx];
          ppIdx = 1 - ppIdx;
        }
        continue;
      }

      const entry = this.compiled.get(eff.defId);
      if (!entry) continue;

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
      if (entry.prePasses && this.hdrFBOs && this.hdrTextures) {
        let hdrIdx = 0;
        for (const pp of entry.prePasses) {
          if (pp.linearFilter) this.setTextureFilter(input, true);
          this.drawPass(
            pp.program,
            this.hdrFBOs[hdrIdx],
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
          input = this.hdrTextures[hdrIdx];
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
        const pair = this.getFxFeedback(eff.instanceId, input, time);
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
        if (isLast) resultTex = input;
        continue;
      }

      if (isLast) {
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
        if (entry.def.linearFilter) this.setTextureFilter(input, false);
        resultTex = finalTex;
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
    if (!resultTex) {
      this.drawPass(this.passthrough, finalFbo, this.sourceTexture!, 1.0, time);
      resultTex = finalTex;
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
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Blend the text overlay (if any) over the rendered frame and draw it to the canvas. */
  private presentFrame(mainResult: WebGLTexture, writeIdx: 0 | 1) {
    if (this.textOverlayPhrase && this.textTexture && this.textBlendProgram) {
      this.drawBlendToCanvas(
        mainResult,
        this.textTexture,
        this.textBlendMode,
        this.textInvert,
        this.textOpacity,
      );
    } else {
      this.drawPass(this.passthrough, null, mainResult, -1.0, 0);
    }
    this.fbIdx = writeIdx;
  }

  /**
   * Get (or lazily create) the private history buffer for a feedback effect.
   * New buffers are seeded with the current chain input at that slot, so the
   * effect starts from valid history instead of uninitialized memory.
   */
  private getFxFeedback(instanceId: string, seedTex: WebGLTexture, time: number) {
    let pair = this.fxFeedback.get(instanceId);
    if (!pair) {
      const textures: [WebGLTexture, WebGLTexture] = [
        this.createTexture(this.imgW, this.imgH),
        this.createTexture(this.imgW, this.imgH),
      ];
      const fbos = this.createFBOPair(textures);
      pair = { textures, fbos, idx: 0 };
      this.fxFeedback.set(instanceId, pair);
      this.drawPass(this.passthrough, fbos[0], seedTex, 1.0, time);
      this.drawPass(this.passthrough, fbos[1], seedTex, 1.0, time);
    }
    return pair;
  }

  /** For effects with a speed param, accumulate phase so speed changes don't cause jumps. */
  private getEffectTime(
    eff: EffectInstance,
    time: number,
    dt: number,
  ): { time: number; delta: number } {
    if (!("speed" in eff.values)) return { time, delta: dt };
    const speed = eff.values.speed as number;
    const prev = this.phaseMap.get(eff.instanceId) ?? 0;
    const phase = prev + dt * speed;
    this.phaseMap.set(eff.instanceId, phase);
    return { time: phase, delta: dt * speed };
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
    gl.bindVertexArray(this.quadVAO);
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

  /** Composite an overlay texture over a main texture into the target FBO (normal blend + opacity). */
  private compositeOverlayToFBO(
    mainTex: WebGLTexture,
    overlayTex: WebGLTexture,
    targetFBO: WebGLFramebuffer,
    opacity: number,
  ) {
    const gl = this.gl;
    const prog = this.textBlendProgram;
    if (!prog) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
    gl.viewport(0, 0, this.imgW, this.imgH);
    gl.useProgram(prog.program);
    if (prog.uniforms["u_flipY"]) gl.uniform1f(prog.uniforms["u_flipY"], 1.0);
    if (prog.uniforms["u_blendMode"])
      gl.uniform1i(prog.uniforms["u_blendMode"], 0);
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
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
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
    const frame = resolveFrame(state, params, time, this.imgW, this.imgH);

    // The full-res 2D-canvas redraw + texture upload is the expensive part of
    // this overlay — skip both when the HUD would be pixel-identical (e.g.
    // locked boxes that have settled).
    const gl = this.gl;
    const sig =
      eff.instanceId +
      "|" +
      trackingFrameSignature(frame, params, time, this.imgW, this.imgH);
    const texValid =
      this.trackingTexture !== null &&
      this.trackingTexW === this.imgW &&
      this.trackingTexH === this.imgH;
    if (!texValid || sig !== this.lastTrackingSig) {
      if (!this.trackingCanvas) {
        this.trackingCanvas = document.createElement("canvas");
      }
      drawTrackingToCanvas(
        this.trackingCanvas,
        this.imgW,
        this.imgH,
        frame,
        params,
        time,
      );
      if (!texValid) {
        if (this.trackingTexture) gl.deleteTexture(this.trackingTexture);
        this.trackingTexture = this.createTexture(this.imgW, this.imgH);
        this.trackingTexW = this.imgW;
        this.trackingTexH = this.imgH;
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
    this.abortPendingSaliency();
    if (this.salTexture) gl.deleteTexture(this.salTexture);
    this.salTexture = null;
    if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
    this.salFBO = null;
    if (this.salPBO) gl.deleteBuffer(this.salPBO);
    this.salPBO = null;
    this.trackingStates.clear();
    if (this.textTexture) gl.deleteTexture(this.textTexture);
    this.textTexture = null;
    if (this.textBlendProgram) gl.deleteProgram(this.textBlendProgram.program);
    this.textBlendProgram = null;
    this.deleteTexturePair(this.ppTextures);
    this.deleteFBOPair(this.ppFBOs);
    this.deleteTexturePair(this.fbTextures);
    this.deleteFBOPair(this.fbFBOs);
    this.deleteTexturePair(this.hdrTextures);
    this.deleteFBOPair(this.hdrFBOs);
    this.deleteTexturePair(this.sceneTextures);
    this.deleteFBOPair(this.sceneFBOs);
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
    for (const entry of this.compiled.values()) {
      gl.deleteProgram(entry.program.program);
      if (entry.prePasses) {
        for (const pp of entry.prePasses) gl.deleteProgram(pp.program.program);
      }
    }
    gl.deleteVertexArray(this.quadVAO);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** 16x1 ASCII glyph atlases (sparsest leftmost), one per charset, shared by the ascii effect. */
  private glyphTextures = new Map<string, WebGLTexture>();

  private buildGlyphAtlas(chars: string): WebGLTexture {
    const cell = 64;
    const canvas = document.createElement("canvas");
    canvas.width = cell * chars.length;
    canvas.height = cell;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.floor(cell * 0.75)}px "Consolas", "Lucida Console", "Menlo", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < chars.length; i++) {
      ctx.save();
      ctx.translate(i * cell + cell / 2, cell / 2 + 1);
      // Stretch glyphs so they nearly fill the cell: chunky characters, tight gaps
      ctx.scale(1.9, 1.25);
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();
    }
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Mipmapped: without mips, small cell sizes undersample glyphs and
    // produce dark-square moire patches.
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(
        gl.TEXTURE_2D,
        aniso.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(4, max),
      );
    }
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
    gl.bindVertexArray(null);
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

  private createHdrTexture(width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

  private createFBOPair(
    textures: [WebGLTexture, WebGLTexture],
  ): [WebGLFramebuffer, WebGLFramebuffer] {
    const gl = this.gl;
    const fbos: [WebGLFramebuffer, WebGLFramebuffer] = [
      gl.createFramebuffer()!,
      gl.createFramebuffer()!,
    ];
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        textures[i],
        0,
      );
    }
    return fbos;
  }

  private setupPingPong() {
    const gl = this.gl;
    this.deleteTexturePair(this.ppTextures);
    this.deleteFBOPair(this.ppFBOs);
    this.deleteTexturePair(this.fbTextures);
    this.deleteFBOPair(this.fbFBOs);
    this.deleteTexturePair(this.hdrTextures);
    this.deleteFBOPair(this.hdrFBOs);
    this.deleteTexturePair(this.sceneTextures);
    this.deleteFBOPair(this.sceneFBOs);
    if (this.textTexture) {
      gl.deleteTexture(this.textTexture);
      this.textTexture = null;
    }
    if (this.trackingTexture) {
      gl.deleteTexture(this.trackingTexture);
      this.trackingTexture = null;
    }
    this.trackingTexW = 0;
    this.trackingTexH = 0;
    this.lastTrackingSig = "";
    this.abortPendingSaliency();
    if (this.salTexture) gl.deleteTexture(this.salTexture);
    if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
    if (this.salPBO) gl.deleteBuffer(this.salPBO);
    this.salTexture = null;
    this.salFBO = null;
    this.salPBO = null;
    this.salW = 0;
    this.salH = 0;

    this.ppTextures = [
      this.createTexture(this.imgW, this.imgH),
      this.createTexture(this.imgW, this.imgH),
    ];
    this.ppFBOs = this.createFBOPair(this.ppTextures);

    this.fbTextures = [
      this.createTexture(this.imgW, this.imgH),
      this.createTexture(this.imgW, this.imgH),
    ];
    this.fbFBOs = this.createFBOPair(this.fbTextures);

    // Half resolution (min 1px) — see hdrTextures docstring.
    this.hdrW = Math.max(1, Math.round(this.imgW / 2));
    this.hdrH = Math.max(1, Math.round(this.imgH / 2));
    this.hdrTextures = [
      this.createHdrTexture(this.hdrW, this.hdrH),
      this.createHdrTexture(this.hdrW, this.hdrH),
    ];
    this.hdrFBOs = this.createFBOPair(this.hdrTextures);

    this.sceneTextures = [
      this.createTexture(this.imgW, this.imgH),
      this.createTexture(this.imgW, this.imgH),
    ];
    this.sceneFBOs = this.createFBOPair(this.sceneTextures);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbIdx = 0;
    for (const pair of this.fxFeedback.values()) {
      this.deleteTexturePair(pair.textures);
      this.deleteFBOPair(pair.fbos);
    }
    this.fxFeedback.clear();
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

  /** Draw to canvas: blend main texture with overlay (mode + invert + opacity). */
  private drawBlendToCanvas(
    mainTex: WebGLTexture,
    overlayTex: WebGLTexture,
    blendMode: TextOverlayBlendMode = "normal",
    invert = false,
    opacity = 1,
  ) {
    const gl = this.gl;
    const prog = this.textBlendProgram;
    if (!prog) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog.program);
    if (prog.uniforms["u_flipY"]) gl.uniform1f(prog.uniforms["u_flipY"], -1.0);
    if (prog.uniforms["u_blendMode"])
      gl.uniform1i(
        prog.uniforms["u_blendMode"],
        GlRenderer.BLEND_MODE_VALUES[blendMode],
      );
    if (prog.uniforms["u_invert"])
      gl.uniform1f(prog.uniforms["u_invert"], invert ? 1 : 0);
    if (prog.uniforms["u_opacity"])
      gl.uniform1f(prog.uniforms["u_opacity"], opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mainTex);
    if (prog.uniforms["u_texture"]) gl.uniform1i(prog.uniforms["u_texture"], 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, overlayTex);
    if (prog.uniforms["u_texture2"])
      gl.uniform1i(prog.uniforms["u_texture2"], 2);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

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
    if (compiled.uniforms["u_feedback"] && this.fbTextures) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(
        gl.TEXTURE_2D,
        feedbackTex ?? this.fbTextures[this.fbIdx],
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

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
