import type { EffectInstance } from '../effects';
import { drawPhraseToCanvas } from '../text-overlay';
import type { TextOverlayStyle } from '../text-overlay';
import type { DrawPhraseOptions } from '../text-overlay';
import { createProgram, getUniformLocations } from './utils';
import {
  VERTEX_SHADER,
  PASSTHROUGH_FRAG,
  ACCUMULATE_FRAG,
  TEXT_BLEND_FRAG,
  EFFECT_SHADERS,
  type EffectShaderDef,
} from './effect-shaders';
import type { TextSafeEffectId, TextOverlayBlendMode } from '../text-overlay';

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation>;
}

export class GlRenderer {
  private gl: WebGL2RenderingContext;
  private quadVAO: WebGLVertexArrayObject;
  private sourceTexture: WebGLTexture | null = null;
  private ppTextures: [WebGLTexture, WebGLTexture] | null = null;
  private ppFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private fbTextures: [WebGLTexture, WebGLTexture] | null = null;
  private fbFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private fbIdx = 0;
  private passthrough: CompiledProgram;
  private accumulateProgram: CompiledProgram;
  private _accumulationAmount = 0;
  private compiled = new Map<string, { program: CompiledProgram; def: EffectShaderDef }>();
  private textTexture: WebGLTexture | null = null;
  private textBlendProgram: CompiledProgram | null = null;
  /** Current overlay phrase; null = no overlay. */
  private textOverlayPhrase: string | null = null;
  private textOverlayStyle: TextOverlayStyle | null = null;
  private textOverlayEffectIds: string[] = [];
  private textBlendMode: TextOverlayBlendMode = 'normal';
  private textInvert = false;
  private textOpacity = 1;
  /** Cache for setTextOverlay: skip redraw when phrase/seed/layout/style/dims unchanged. */
  private lastTextPhrase: string | null = null;
  private lastTextSeed: number | null = null;
  private lastTextLayout: string | null = null;
  private lastTextStyleKey: string | null = null;
  private lastTextW = 0;
  private lastTextH = 0;
  private imgW = 0;
  private imgH = 0;
  private lastTime = -1;
  private phaseMap = new Map<string, number>();

  /** Default param values for text-safe effects (keeps text readable). */
  private static TEXT_EFFECT_DEFAULTS: Record<string, Record<string, number | string>> = {
    scanlines: { count: 80, amount: 0.4 },
    grain: { amount: 0.25, rgb: 0, blendMode: 'soft' },
    vignette: { size: 0.6, amount: 0.4 },
    bleach: { amount: 0.35 },
  };

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.quadVAO = this.createQuad();
    this.passthrough = this.compile(PASSTHROUGH_FRAG);
    this.accumulateProgram = this.compile(ACCUMULATE_FRAG);
    this.textBlendProgram = this.compile(TEXT_BLEND_FRAG);
    this.compileAllEffects();
  }

  loadImage(image: HTMLImageElement) {
    const gl = this.gl;
    const naturalW = image.naturalWidth;
    const naturalH = image.naturalHeight;
    this.imgW = naturalW;
    this.imgH = naturalH;
    this.canvas.width = this.imgW;
    this.canvas.height = this.imgH;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = this.createTexture(naturalW, naturalH);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    this.setupPingPong();
  }

  loadVideo(video: HTMLVideoElement) {
    const gl = this.gl;
    const w = video.videoWidth;
    const h = video.videoHeight;
    this.imgW = w;
    this.imgH = h;
    this.canvas.width = w;
    this.canvas.height = h;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = this.createTexture(w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    this.setupPingPong();
  }

  updateSourceFrame(source: HTMLVideoElement) {
    if (!this.sourceTexture) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** Upload a new image to the existing source texture without re-allocating FBOs. */
  updateSourceImage(image: HTMLImageElement) {
    if (!this.sourceTexture) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  /** Set how much of the previous frame bleeds into the next render (0 = off, 1 = full carry). */
  setAccumulation(amount: number) {
    this._accumulationAmount = amount;
  }

  /**
   * Reset the feedback buffer to the current source image.
   * Call after updateSourceImage() on beat-interval resets.
   */
  clearFeedback() {
    if (!this.sourceTexture || !this.fbFBOs || !this.fbTextures) return;
    const writeIdx = (1 - this.fbIdx) as 0 | 1;
    this.drawPass(this.passthrough, this.fbFBOs[writeIdx], this.sourceTexture, 1.0, 0);
    this.fbIdx = writeIdx;
  }

  /**
   * Set text overlay for the next render. Pass null to clear.
   * options: layout, seed, blendMode, invert.
   * Legacy: 3rd param as string is treated as single textEffectIds member.
   */
  setTextOverlay(
    phrase: string | null,
    style?: TextOverlayStyle | null,
    textEffectIdOrOptions?: TextSafeEffectId | '' | (DrawPhraseOptions & {
      blendMode?: TextOverlayBlendMode;
      invert?: boolean;
      opacity?: number;
    }),
    options?: DrawPhraseOptions & {
      blendMode?: TextOverlayBlendMode;
      invert?: boolean;
      opacity?: number;
    },
  ) {
    this.textOverlayPhrase = phrase;
    this.textOverlayStyle = style ?? null;
    const opts = options ?? (typeof textEffectIdOrOptions === 'object' ? textEffectIdOrOptions : null);
    const legacyId = typeof textEffectIdOrOptions === 'string' ? textEffectIdOrOptions : '';
    this.textOverlayEffectIds = legacyId ? [legacyId] : [];
    this.textBlendMode = opts?.blendMode ?? 'normal';
    this.textInvert = opts?.invert ?? false;
    this.textOpacity = opts?.opacity ?? 1;
    if (!phrase || !style) return;
    if (this.imgW <= 0 || this.imgH <= 0) return;
    const layout = opts?.layout ?? 'block';
    const seed = opts?.layout === 'scattered' ? (opts?.seed ?? 0) : 0;
    const styleKey = JSON.stringify(style);
    if (
      this.lastTextPhrase === phrase &&
      this.lastTextSeed === seed &&
      this.lastTextLayout === layout &&
      this.lastTextStyleKey === styleKey &&
      this.lastTextW === this.imgW &&
      this.lastTextH === this.imgH
    ) {
      return; // reuse existing text texture
    }
    this.lastTextPhrase = phrase;
    this.lastTextSeed = seed;
    this.lastTextLayout = layout;
    this.lastTextStyleKey = styleKey;
    this.lastTextW = this.imgW;
    this.lastTextH = this.imgH;
    const drawOptions: DrawPhraseOptions = {
      layout,
      seed: opts?.layout === 'scattered' ? (opts?.seed ?? 0) : undefined,
    };
    const textCanvas = drawPhraseToCanvas(phrase, this.imgW, this.imgH, style, drawOptions);
    const gl = this.gl;
    if (!this.textTexture) {
      this.textTexture = this.createTexture(this.imgW, this.imgH);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  }

  /** Clear text overlay (e.g. after recording). */
  clearTextOverlay() {
    this.textOverlayPhrase = null;
    this.textOverlayStyle = null;
    this.textOverlayEffectIds = [];
    this.lastTextSeed = null;
    this.lastTextLayout = null;
    this.lastTextStyleKey = null;
  }

  /** Resize output canvas and ping-pong/feedback buffers. Source texture is unchanged; sampling scales automatically. */
  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.imgW = width;
    this.imgH = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.setupPingPong();
  }

  render(effects: EffectInstance[], time = 0) {
    const gl = this.gl;
    if (!this.sourceTexture || !this.ppTextures || !this.ppFBOs || !this.fbTextures || !this.fbFBOs) return;

    // Compute delta time for phase accumulation
    const dt = this.lastTime >= 0 ? time - this.lastTime : 0;
    this.lastTime = time;
    // Guard against time discontinuities (e.g. switching between recording and real-time)
    const safeDt = dt > 0 && dt < 0.5 ? dt : 0;

    const enabled = effects.filter((e) => e.enabled);
    const writeIdx = (1 - this.fbIdx) as 0 | 1;

    // Accumulation pre-pass: blend source with previous frame before effect chain.
    let effectiveSource = this.sourceTexture!;
    let startPpIdx = 0;
    if (this._accumulationAmount > 0 && this.ppFBOs && this.ppTextures) {
      // drawPass automatically binds fbTextures[fbIdx] as u_feedback.
      // Write blend result to ppFBO[0]; start effect chain at ppIdx=1 to avoid overwriting it.
      this.drawPass(this.accumulateProgram, this.ppFBOs[0], this.sourceTexture!, 1.0, 0, {
        fragment: ACCUMULATE_FRAG,
        setUniforms: (gl: WebGL2RenderingContext, locs: Record<string, WebGLUniformLocation>, _values: Record<string, number | string>) => {
          if (locs['u_amount']) gl.uniform1f(locs['u_amount'], this._accumulationAmount);
        },
      }, {});
      effectiveSource = this.ppTextures[0];
      startPpIdx = 1;
    }

    if (enabled.length === 0) {
      this.drawPass(this.passthrough, this.fbFBOs[writeIdx], effectiveSource, 1.0, time);
      const mainResult = this.fbTextures[writeIdx]!;
      if (this.textOverlayPhrase && this.textTexture && this.textBlendProgram) {
        const overlayTex = this.runTextEffects(this.textTexture, time);
        this.drawBlendToCanvas(mainResult, overlayTex, this.textBlendMode, this.textInvert, this.textOpacity);
      } else {
        this.drawPass(this.passthrough, null, mainResult, -1.0, 0);
      }
      this.fbIdx = writeIdx;
      return;
    }

    let input = effectiveSource;
    let ppIdx = startPpIdx;

    for (let i = 0; i < enabled.length; i++) {
      const eff = enabled[i];
      const entry = this.compiled.get(eff.defId);
      if (!entry) continue;

      const effectTime = this.getEffectTime(eff, time, safeDt);
      const isLast = i === enabled.length - 1;

      if (isLast) {
        this.drawPass(entry.program, this.fbFBOs[writeIdx], input, 1.0, effectTime, entry.def, eff.values);
      } else {
        this.drawPass(
          entry.program,
          this.ppFBOs[ppIdx],
          input,
          1.0,
          effectTime,
          entry.def,
          eff.values,
        );
        input = this.ppTextures[ppIdx];
        ppIdx = 1 - ppIdx;
      }
    }

    const mainResult = this.fbTextures[writeIdx]!;
    if (this.textOverlayPhrase && this.textTexture && this.textBlendProgram) {
      const overlayTex = this.runTextEffects(this.textTexture, time);
      this.drawBlendToCanvas(mainResult, overlayTex, this.textBlendMode, this.textInvert, this.textOpacity);
    } else {
      this.drawPass(this.passthrough, null, mainResult, -1.0, 0);
    }
    this.fbIdx = writeIdx;
  }

  /** For effects with a speed param, accumulate phase so speed changes don't cause jumps. */
  private getEffectTime(eff: EffectInstance, time: number, dt: number): number {
    if (!('speed' in eff.values)) return time;
    const speed = eff.values.speed as number;
    const prev = this.phaseMap.get(eff.instanceId) ?? 0;
    const phase = prev + dt * speed;
    this.phaseMap.set(eff.instanceId, phase);
    return phase;
  }

  destroy() {
    const gl = this.gl;
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    if (this.textTexture) gl.deleteTexture(this.textTexture);
    this.textTexture = null;
    if (this.textBlendProgram) gl.deleteProgram(this.textBlendProgram.program);
    this.textBlendProgram = null;
    this.deleteTexturePair(this.ppTextures);
    this.deleteFBOPair(this.ppFBOs);
    this.deleteTexturePair(this.fbTextures);
    this.deleteFBOPair(this.fbFBOs);
    gl.deleteProgram(this.passthrough.program);
    for (const { program } of this.compiled.values()) {
      gl.deleteProgram(program.program);
    }
    gl.deleteVertexArray(this.quadVAO);
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
        this.compiled.set(id, { program, def });
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
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    return tex;
  }

  private deleteTexturePair(pair: [WebGLTexture, WebGLTexture] | null) {
    if (pair) { this.gl.deleteTexture(pair[0]); this.gl.deleteTexture(pair[1]); }
  }

  private deleteFBOPair(pair: [WebGLFramebuffer, WebGLFramebuffer] | null) {
    if (pair) { this.gl.deleteFramebuffer(pair[0]); this.gl.deleteFramebuffer(pair[1]); }
  }

  private createFBOPair(textures: [WebGLTexture, WebGLTexture]): [WebGLFramebuffer, WebGLFramebuffer] {
    const gl = this.gl;
    const fbos: [WebGLFramebuffer, WebGLFramebuffer] = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i], 0);
    }
    return fbos;
  }

  private setupPingPong() {
    const gl = this.gl;
    this.deleteTexturePair(this.ppTextures);
    this.deleteFBOPair(this.ppFBOs);
    this.deleteTexturePair(this.fbTextures);
    this.deleteFBOPair(this.fbFBOs);
    if (this.textTexture) {
      gl.deleteTexture(this.textTexture);
      this.textTexture = null;
    }

    this.ppTextures = [this.createTexture(this.imgW, this.imgH), this.createTexture(this.imgW, this.imgH)];
    this.ppFBOs = this.createFBOPair(this.ppTextures);

    this.fbTextures = [this.createTexture(this.imgW, this.imgH), this.createTexture(this.imgW, this.imgH)];
    this.fbFBOs = this.createFBOPair(this.fbTextures);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbIdx = 0;
  }

  /** Run zero or more effects on the text texture; returns final texture (ping-pong). */
  private runTextEffects(inputTex: WebGLTexture, time: number): WebGLTexture {
    const ids = this.textOverlayEffectIds;
    if (!ids.length || !this.ppFBOs || !this.ppTextures) return inputTex;
    let current: WebGLTexture = inputTex;
    let ppIdx = 0;
    for (const effectId of ids) {
      const entry = this.compiled.get(effectId);
      if (!entry) continue;
      const defs = GlRenderer.TEXT_EFFECT_DEFAULTS[effectId];
      this.drawPass(
        entry.program,
        this.ppFBOs[ppIdx],
        current,
        1.0,
        time,
        entry.def,
        defs ? { ...defs } : {},
      );
      current = this.ppTextures[ppIdx]!;
      ppIdx = 1 - ppIdx;
    }
    return current;
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
    blendMode: TextOverlayBlendMode = 'normal',
    invert = false,
    opacity = 1,
  ) {
    const gl = this.gl;
    const prog = this.textBlendProgram;
    if (!prog) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog.program);
    if (prog.uniforms['u_flipY']) gl.uniform1f(prog.uniforms['u_flipY'], -1.0);
    if (prog.uniforms['u_blendMode']) gl.uniform1i(prog.uniforms['u_blendMode'], GlRenderer.BLEND_MODE_VALUES[blendMode]);
    if (prog.uniforms['u_invert']) gl.uniform1f(prog.uniforms['u_invert'], invert ? 1 : 0);
    if (prog.uniforms['u_opacity']) gl.uniform1f(prog.uniforms['u_opacity'], opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mainTex);
    if (prog.uniforms['u_texture']) gl.uniform1i(prog.uniforms['u_texture'], 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, overlayTex);
    if (prog.uniforms['u_texture2']) gl.uniform1i(prog.uniforms['u_texture2'], 2);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  private drawPass(
    compiled: CompiledProgram,
    fbo: WebGLFramebuffer | null,
    inputTex: WebGLTexture,
    flipY: number,
    time: number,
    shaderDef?: EffectShaderDef,
    values?: Record<string, number | string>,
  ) {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    if (fbo) {
      gl.viewport(0, 0, this.imgW, this.imgH);
    } else {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    gl.useProgram(compiled.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    if (compiled.uniforms['u_texture']) {
      gl.uniform1i(compiled.uniforms['u_texture'], 0);
    }
    if (compiled.uniforms['u_flipY']) {
      gl.uniform1f(compiled.uniforms['u_flipY'], flipY);
    }
    if (compiled.uniforms['u_time']) {
      gl.uniform1f(compiled.uniforms['u_time'], time);
    }
    if (compiled.uniforms['u_feedback'] && this.fbTextures) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fbTextures[this.fbIdx]);
      gl.uniform1i(compiled.uniforms['u_feedback'], 1);
      gl.activeTexture(gl.TEXTURE0);
    }

    if (shaderDef && values) {
      shaderDef.setUniforms(gl, compiled.uniforms, values);
    }

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
