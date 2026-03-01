import type { EffectInstance } from '../effects';
import { createProgram, getUniformLocations } from './utils';
import {
  VERTEX_SHADER,
  PASSTHROUGH_FRAG,
  EFFECT_SHADERS,
  type EffectShaderDef,
} from './effect-shaders';
import { TRANSITION_SHADERS } from './transition-shaders';
import type { TransitionType } from '../slideshow/types';

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
  private compiled = new Map<string, { program: CompiledProgram; def: EffectShaderDef }>();
  private compiledTransitions = new Map<TransitionType, CompiledProgram>();
  private transitionTexture: WebGLTexture | null = null;
  private imgW = 0;
  private imgH = 0;
  private lastTime = -1;
  private phaseMap = new Map<string, number>();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.quadVAO = this.createQuad();
    this.passthrough = this.compile(PASSTHROUGH_FRAG);
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

  /** Upload an image as the transition (outgoing) texture. */
  setTransitionImage(image: HTMLImageElement) {
    const gl = this.gl;
    if (!this.transitionTexture) {
      this.transitionTexture = this.createTexture(this.imgW, this.imgH);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.transitionTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  /** Clear the transition texture (no transition active). */
  clearTransitionImage() {
    if (this.transitionTexture) {
      this.gl.deleteTexture(this.transitionTexture);
      this.transitionTexture = null;
    }
  }

  /**
   * Render with a transition pre-pass: blend transitionTexture (outgoing) → sourceTexture (incoming)
   * into ppFBO[0], then run the normal effect chain starting from that blended result.
   */
  renderWithTransition(effects: EffectInstance[], time: number, transitionId: TransitionType, progress: number) {
    const gl = this.gl;
    if (!this.sourceTexture || !this.transitionTexture || !this.ppTextures || !this.ppFBOs || !this.fbTextures || !this.fbFBOs) {
      return this.render(effects, time);
    }

    const tProg = this.compiledTransitions.get(transitionId);
    if (!tProg) return this.render(effects, time);

    // Compute delta time for phase accumulation
    const dt = this.lastTime >= 0 ? time - this.lastTime : 0;
    this.lastTime = time;
    const safeDt = dt > 0 && dt < 0.5 ? dt : 0;

    // Pre-pass: blend transition into ppFBO[0]
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ppFBOs[0]);
    gl.viewport(0, 0, this.imgW, this.imgH);
    gl.useProgram(tProg.program);

    // u_texture = outgoing (transition texture)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.transitionTexture);
    if (tProg.uniforms['u_texture']) gl.uniform1i(tProg.uniforms['u_texture'], 0);

    // u_texture2 = incoming (source texture)
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    if (tProg.uniforms['u_texture2']) gl.uniform1i(tProg.uniforms['u_texture2'], 2);

    if (tProg.uniforms['u_progress']) gl.uniform1f(tProg.uniforms['u_progress'], progress);
    if (tProg.uniforms['u_flipY']) gl.uniform1f(tProg.uniforms['u_flipY'], 1.0);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);

    // Now run the normal effect chain using the blended result as input
    const enabled = effects.filter((e) => e.enabled);
    const writeIdx = (1 - this.fbIdx) as 0 | 1;

    if (enabled.length === 0) {
      this.drawPass(this.passthrough, this.fbFBOs[writeIdx], this.ppTextures[0], 1.0, time);
      this.drawPass(this.passthrough, null, this.fbTextures[writeIdx], -1.0, 0);
      this.fbIdx = writeIdx;
      return;
    }

    let input: WebGLTexture = this.ppTextures[0];
    let ppIdx = 1; // start at 1 since ppFBO[0] is used by transition

    for (let i = 0; i < enabled.length; i++) {
      const eff = enabled[i];
      const entry = this.compiled.get(eff.defId);
      if (!entry) continue;

      const effectTime = this.getEffectTime(eff, time, safeDt);
      const isLast = i === enabled.length - 1;

      if (isLast) {
        this.drawPass(entry.program, this.fbFBOs[writeIdx], input, 1.0, effectTime, entry.def, eff.values);
      } else {
        this.drawPass(entry.program, this.ppFBOs[ppIdx], input, 1.0, effectTime, entry.def, eff.values);
        input = this.ppTextures[ppIdx];
        ppIdx = 1 - ppIdx;
      }
    }

    this.drawPass(this.passthrough, null, this.fbTextures[writeIdx], -1.0, 0);
    this.fbIdx = writeIdx;
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

    if (enabled.length === 0) {
      this.drawPass(this.passthrough, this.fbFBOs[writeIdx], this.sourceTexture!, 1.0, time);
      this.drawPass(this.passthrough, null, this.fbTextures[writeIdx], -1.0, 0);
      this.fbIdx = writeIdx;
      return;
    }

    let input = this.sourceTexture!;
    let ppIdx = 0;

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

    this.drawPass(this.passthrough, null, this.fbTextures[writeIdx], -1.0, 0);
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
    if (this.transitionTexture) gl.deleteTexture(this.transitionTexture);
    this.deleteTexturePair(this.ppTextures);
    this.deleteFBOPair(this.ppFBOs);
    this.deleteTexturePair(this.fbTextures);
    this.deleteFBOPair(this.fbFBOs);
    gl.deleteProgram(this.passthrough.program);
    for (const { program } of this.compiled.values()) {
      gl.deleteProgram(program.program);
    }
    for (const program of this.compiledTransitions.values()) {
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
    for (const [id, def] of Object.entries(TRANSITION_SHADERS)) {
      try {
        const program = this.compile(def.fragment);
        this.compiledTransitions.set(id as TransitionType, program);
      } catch (e) {
        console.error(`Failed to compile transition "${id}":`, e);
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

    this.ppTextures = [this.createTexture(this.imgW, this.imgH), this.createTexture(this.imgW, this.imgH)];
    this.ppFBOs = this.createFBOPair(this.ppTextures);

    this.fbTextures = [this.createTexture(this.imgW, this.imgH), this.createTexture(this.imgW, this.imgH)];
    this.fbFBOs = this.createFBOPair(this.fbTextures);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbIdx = 0;
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
