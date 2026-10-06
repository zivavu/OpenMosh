import type { ChromaKey, KeyColor } from "../media";
import { SOURCE_EDIT_PREVIEW_FRAG } from "./effect-shaders";
import {
	compileKeyProgram,
	KeyReachPass,
	setKeyPointUniforms,
	type KeyProgram,
} from "./key-pass";

/**
 * The media editor's view of a source: its decoded frame keyed by the same shader
 * and connected fill the renderer uses, so what the dialog cuts is what renders.
 * The erase mask arrives as coverage already moved into place.
 */
export class SourceEditPreview {
	#gl: WebGL2RenderingContext;
	#prog: KeyProgram;
	#reach: KeyReachPass;
	#frame: WebGLTexture;
	#frameW = 0;
	#frameH = 0;
	/** For reading picked colours back out of the frame. */
	#frameFbo: WebGLFramebuffer;
	#mask: WebGLTexture;
	#hasMask = false;

	constructor(canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl2", {
			alpha: true,
			antialias: false,
			depth: false,
			stencil: false,
		});
		if (!gl) throw new Error("WebGL2 not supported");
		this.#gl = gl;
		this.#prog = compileKeyProgram(gl, SOURCE_EDIT_PREVIEW_FRAG);
		this.#reach = new KeyReachPass(gl);
		this.#frame = this.#texture();
		this.#mask = this.#texture();
		this.#frameFbo = gl.createFramebuffer()!;

		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			gl.STATIC_DRAW,
		);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	}

	get hasFrame(): boolean {
		return this.#frameW > 0;
	}

	/** Uploaded the way the renderer uploads a layer's media. */
	setFrame(source: TexImageSource, w: number, h: number) {
		if (w <= 0 || h <= 0) return;
		const gl = this.#gl;
		gl.bindTexture(gl.TEXTURE_2D, this.#frame);
		if (w === this.#frameW && h === this.#frameH) {
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				source,
			);
		} else {
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				source,
			);
			this.#frameW = w;
			this.#frameH = h;
		}
	}

	/** Erase coverage in source space, red = keep; null erases nothing. */
	setMask(px: Uint8ClampedArray | null, w: number, h: number) {
		this.#hasMask = !!px && w > 0 && h > 0;
		if (!px || !this.#hasMask) return;
		const gl = this.#gl;
		gl.bindTexture(gl.TEXTURE_2D, this.#mask);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			w,
			h,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			px,
		);
	}

	/** The whole frame, uncropped (the dialog shades the crop itself), into the canvas.
	 * `solo`: cut with that point alone, or -1 for the whole key. */
	draw(key: ChromaKey, solo = -1) {
		const gl = this.#gl;
		gl.clearColor(0, 0, 0, 0);
		if (!this.hasFrame) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
			gl.clear(gl.COLOR_BUFFER_BIT);
			return;
		}
		const reach = this.#reach.run(this.#frame, this.#frameW, this.#frameH, key);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.clear(gl.COLOR_BUFFER_BIT);
		const prog = this.#prog;
		const u = prog.uniforms;
		gl.useProgram(prog.program);
		// -1: the canvas's first row is the top, as the source texture's is.
		if (u["u_flipY"]) gl.uniform1f(u["u_flipY"], -1);
		setKeyPointUniforms(gl, prog, key);
		if (u["u_keySolo"]) gl.uniform1f(u["u_keySolo"], solo + 1);
		this.#reach.bind(prog, reach);
		if (u["u_crop"]) gl.uniform4f(u["u_crop"], 0, 0, 1, 1);
		if (u["u_hasMask"]) gl.uniform1f(u["u_hasMask"], this.#hasMask ? 1 : 0);
		if (u["u_maskSdf"]) gl.uniform1f(u["u_maskSdf"], 0);
		if (u["u_maskMix"]) gl.uniform1f(u["u_maskMix"], 0);
		if (u["u_maskShift"]) gl.uniform2f(u["u_maskShift"], 0, 0);
		if (u["u_maskXform"]) gl.uniform3f(u["u_maskXform"], 0, 0, 1);
		gl.activeTexture(gl.TEXTURE3);
		gl.bindTexture(gl.TEXTURE_2D, this.#mask);
		if (u["u_mask"]) gl.uniform1i(u["u_mask"], 3);
		// Never read with u_maskSdf at 0, but a sampler must point at something.
		gl.activeTexture(gl.TEXTURE4);
		gl.bindTexture(gl.TEXTURE_2D, this.#mask);
		if (u["u_maskNext"]) gl.uniform1i(u["u_maskNext"], 4);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.#frame);
		if (u["u_texture"]) gl.uniform1i(u["u_texture"], 0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	/** The frame's average colour in a small square around (x, y), 0..1 of the frame.
	 * Averaged: one full-resolution pixel is mostly grain. */
	sample(x: number, y: number, radius = 2): KeyColor | null {
		if (!this.hasFrame) return null;
		const gl = this.#gl;
		const cx = Math.min(this.#frameW - 1, Math.floor(x * this.#frameW));
		const cy = Math.min(this.#frameH - 1, Math.floor(y * this.#frameH));
		const x0 = Math.max(0, cx - radius);
		const y0 = Math.max(0, cy - radius);
		const w = Math.min(this.#frameW, cx + radius + 1) - x0;
		const h = Math.min(this.#frameH, cy + radius + 1) - y0;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.#frameFbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			this.#frame,
			0,
		);
		const px = new Uint8Array(w * h * 4);
		// The texture's rows run from the source's top, so y needs no flip here.
		gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		let r = 0;
		let g = 0;
		let b = 0;
		const n = w * h;
		for (let i = 0; i < px.length; i += 4) {
			r += px[i];
			g += px[i + 1];
			b += px[i + 2];
		}
		return { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
	}

	#texture(): WebGLTexture {
		const gl = this.#gl;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		// As the renderer's layer textures: LINEAR and clamped.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		return tex;
	}

	dispose() {
		const gl = this.#gl;
		this.#reach.dispose();
		gl.deleteProgram(this.#prog.program);
		gl.deleteTexture(this.#frame);
		gl.deleteTexture(this.#mask);
		gl.deleteFramebuffer(this.#frameFbo);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}
