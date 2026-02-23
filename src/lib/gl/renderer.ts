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
    this.imgW = image.naturalWidth;
    this.imgH = image.naturalHeight;
    this.canvas.width = this.imgW;
    this.canvas.height = this.imgH;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = this.createTexture(this.imgW, this.imgH);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    this.setupPingPong();
  }

  render(effects: EffectInstance[]) {
    const gl = this.gl;
    if (!this.sourceTexture || !this.ppTextures || !this.ppFBOs) return;

    const enabled = effects.filter((e) => e.enabled);

    if (enabled.length === 0) {
      this.drawPass(this.passthrough, null, this.sourceTexture!, -1.0);
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
        this.drawPass(entry.program, null, input, -1.0, entry.def, eff.values);
      } else {
        this.drawPass(
          entry.program,
          this.ppFBOs[ppIdx],
          input,
          1.0,
          entry.def,
          eff.values,
        );
        input = this.ppTextures[ppIdx];
        ppIdx = 1 - ppIdx;
      }
    }
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

    const t0 = this.createTexture(this.imgW, this.imgH);
    const t1 = this.createTexture(this.imgW, this.imgH);
    const f0 = gl.createFramebuffer()!;
    const f1 = gl.createFramebuffer()!;

    gl.bindFramebuffer(gl.FRAMEBUFFER, f0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f1);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.ppTextures = [t0, t1];
    this.ppFBOs = [f0, f1];
  }

  private drawPass(
    compiled: CompiledProgram,
    fbo: WebGLFramebuffer | null,
    inputTex: WebGLTexture,
    flipY: number,
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

    if (shaderDef && values) {
      shaderDef.setUniforms(gl, compiled.uniforms, values);
    }

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
