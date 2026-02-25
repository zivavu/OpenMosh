import type { EffectInstance } from '../effects';
import { createProgram, getUniformLocations } from './utils';
import {
  VERTEX_SHADER,
  PASSTHROUGH_FRAG,
  EFFECT_SHADERS,
  type EffectShaderDef,
} from './effect-shaders';

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
  private imgW = 0;
  private imgH = 0;

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

      const isLast = i === enabled.length - 1;

      if (isLast) {
        this.drawPass(entry.program, this.fbFBOs[writeIdx], input, 1.0, time, entry.def, eff.values);
      } else {
        this.drawPass(
          entry.program,
          this.ppFBOs[ppIdx],
          input,
          1.0,
          time,
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

  destroy() {
    const gl = this.gl;
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    if (this.ppTextures) {
      gl.deleteTexture(this.ppTextures[0]);
      gl.deleteTexture(this.ppTextures[1]);
    }
    if (this.ppFBOs) {
      gl.deleteFramebuffer(this.ppFBOs[0]);
      gl.deleteFramebuffer(this.ppFBOs[1]);
    }
    if (this.fbTextures) {
      gl.deleteTexture(this.fbTextures[0]);
      gl.deleteTexture(this.fbTextures[1]);
    }
    if (this.fbFBOs) {
      gl.deleteFramebuffer(this.fbFBOs[0]);
      gl.deleteFramebuffer(this.fbFBOs[1]);
    }
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    return tex;
  }

  private setupPingPong() {
    const gl = this.gl;
    if (this.ppTextures) {
      gl.deleteTexture(this.ppTextures[0]);
      gl.deleteTexture(this.ppTextures[1]);
    }
    if (this.ppFBOs) {
      gl.deleteFramebuffer(this.ppFBOs[0]);
      gl.deleteFramebuffer(this.ppFBOs[1]);
    }
    if (this.fbTextures) {
      gl.deleteTexture(this.fbTextures[0]);
      gl.deleteTexture(this.fbTextures[1]);
    }
    if (this.fbFBOs) {
      gl.deleteFramebuffer(this.fbFBOs[0]);
      gl.deleteFramebuffer(this.fbFBOs[1]);
    }

    this.ppTextures = [
      this.createTexture(this.imgW, this.imgH),
      this.createTexture(this.imgW, this.imgH),
    ];
    this.ppFBOs = [gl.createFramebuffer()!, gl.createFramebuffer()!];

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ppFBOs[0]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ppTextures[0], 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ppFBOs[1]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ppTextures[1], 0);

    this.fbTextures = [
      this.createTexture(this.imgW, this.imgH),
      this.createTexture(this.imgW, this.imgH),
    ];
    this.fbFBOs = [gl.createFramebuffer()!, gl.createFramebuffer()!];

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbFBOs[0]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTextures[0], 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbFBOs[1]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTextures[1], 0);

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
