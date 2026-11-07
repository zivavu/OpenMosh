/** Draws one moment of Arcs the way arcDrawer paints: each stroke alone into a scratch
 * target, then "over" the picture. Everything is worked out from the timestamp. */

import {
	framebuffer,
	fullscreen,
	FULLSCREEN_VS,
	loc,
	program,
	setInks,
	texture,
} from "../generators/gpu";
import type { Colors } from "../generators/palette";
import { sampleControls, type Controls } from "./controls";
import type { Look } from "./look";
import { ARC_FS, ARC_VS, PRESENT_FS, STROKE_FS } from "./shaders";
import {
	ARC_FLOATS,
	buildArcs,
	MAX_ARC_VERTICES,
	MAX_STROKES,
	STROKE_FLOATS,
} from "./strokes";

/** arcDrawer's pixels are read at this frame size. */
const REFERENCE_SIDE = 960;

interface Target {
	tex: WebGLTexture;
	fbo: WebGLFramebuffer;
}

export class ArcsPass {
	private readonly gl: WebGL2RenderingContext;
	private arcVao: WebGLVertexArrayObject;
	private arcVbo: WebGLBuffer;
	private arcData = new Float32Array(MAX_ARC_VERTICES * ARC_FLOATS);
	private strokeTable = new Float32Array(MAX_STROKES * STROKE_FLOATS);
	private outFbo: WebGLFramebuffer;
	private picture: Target | null = null;
	private scratch: Target | null = null;
	private w = 0;
	private h = 0;
	/** False where the GPU can't render to float: nothing is drawn. */
	readonly supported: boolean;
	/** Strokes in the last frame, for a read-out. */
	strokes = 0;

	constructor(gl: WebGL2RenderingContext) {
		this.gl = gl;
		this.supported = !!gl.getExtension("EXT_color_buffer_float");
		this.outFbo = gl.createFramebuffer()!;
		this.arcVbo = gl.createBuffer()!;
		this.arcVao = gl.createVertexArray()!;
		gl.bindVertexArray(this.arcVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.arcVbo);
		gl.bufferData(gl.ARRAY_BUFFER, this.arcData.byteLength, gl.DYNAMIC_DRAW);
		const stride = ARC_FLOATS * 4;
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 8);
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}

	/** Compiles everything now, so a bad shader fails at load and not mid-song. */
	compile() {
		const { gl } = this;
		program(gl, ARC_VS, ARC_FS);
		program(gl, FULLSCREEN_VS, STROKE_FS);
		program(gl, FULLSCREEN_VS, PRESENT_FS);
	}

	private target(w: number, h: number): Target {
		const { gl } = this;
		const tex = texture(gl, w, h, gl.RGBA16F, { filter: gl.NEAREST });
		return { tex, fbo: framebuffer(gl, tex) };
	}

	private ensureSize(w: number, h: number) {
		if (w === this.w && h === this.h) return;
		this.freeTargets();
		this.w = w;
		this.h = h;
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.picture = this.target(w, h);
		this.scratch = this.target(w, h);
	}

	private freeTargets() {
		for (const t of [this.picture, this.scratch]) {
			if (!t) continue;
			this.gl.deleteTexture(t.tex);
			this.gl.deleteFramebuffer(t.fbo);
		}
		this.picture = null;
		this.scratch = null;
		this.w = 0;
		this.h = 0;
	}

	/** Transparent where nothing is lit, for drawing over other layers. */
	drawToTexture(
		tex: WebGLTexture,
		controls: Controls | null,
		t: number,
		look: Look,
		colors: Colors,
		w: number,
		h: number,
	) {
		const { gl } = this;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			tex,
			0,
		);
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (controls && this.supported) {
			this.draw(controls, t, look, colors, w, h, this.outFbo);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			null,
			0,
		);
	}

	/** Into `out`, or opaque onto the canvas when it's null. */
	draw(
		controls: Controls,
		t: number,
		look: Look,
		colors: Colors,
		w: number,
		h: number,
		out: WebGLFramebuffer | null,
	) {
		const { gl } = this;
		this.ensureSize(w, h);
		const picture = this.picture!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, picture.fbo);
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		this.paintStrokes(controls, t, look, colors, w, h);

		const present = program(gl, FULLSCREEN_VS, PRESENT_FS);
		gl.useProgram(present);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, picture.tex);
		gl.uniform1i(loc(gl, present, "uStrokes"), 0);
		gl.uniform1f(loc(gl, present, "uClear"), out ? 1 : 0);
		gl.uniform1f(loc(gl, present, "uHeight"), h);
		gl.bindFramebuffer(gl.FRAMEBUFFER, out);
		gl.viewport(0, 0, w, h);
		fullscreen(gl);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	private paintStrokes(
		controls: Controls,
		t: number,
		look: Look,
		colors: Colors,
		w: number,
		h: number,
	) {
		const { gl, strokeTable: table } = this;
		const picture = this.picture!;
		const scratch = this.scratch!;
		const { vertices, strokes } = buildArcs(
			this.arcData,
			table,
			sampleControls(controls, t),
			controls,
			look,
			w,
			h,
		);
		this.strokes = strokes;
		if (strokes === 0) return;

		gl.bindVertexArray(this.arcVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.arcVbo);
		gl.bufferSubData(
			gl.ARRAY_BUFFER,
			0,
			this.arcData,
			0,
			vertices * ARC_FLOATS,
		);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		const arc = program(gl, ARC_VS, ARC_FS);
		gl.useProgram(arc);
		gl.uniform2f(loc(gl, arc, "uRes"), w, h);
		gl.uniform1f(
			loc(gl, arc, "uBlur"),
			(look.arcBlur * Math.sqrt(w * h)) / REFERENCE_SIDE,
		);
		const stroke = program(gl, FULLSCREEN_VS, STROKE_FS);
		gl.useProgram(stroke);
		setInks(gl, stroke, colors);
		gl.uniform1i(loc(gl, stroke, "uStroke"), 0);
		const uAlpha = loc(gl, stroke, "uAlpha");
		const uTone = loc(gl, stroke, "uTone");

		gl.activeTexture(gl.TEXTURE0);
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.enable(gl.BLEND);
		gl.enable(gl.SCISSOR_TEST);
		for (let s = 0; s < strokes; s++) {
			const row = s * STROKE_FLOATS;
			const x0 = Math.max(0, Math.floor(table[row + 4]));
			const y0 = Math.max(0, Math.floor(table[row + 5]));
			const x1 = Math.min(w, Math.ceil(table[row + 6]));
			const y1 = Math.min(h, Math.ceil(table[row + 7]));
			if (x1 <= x0 || y1 <= y0) continue;
			gl.scissor(x0, y0, x1 - x0, y1 - y0);

			gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.useProgram(arc);
			gl.bindVertexArray(this.arcVao);
			gl.blendEquation(gl.MAX);
			gl.blendFunc(gl.ONE, gl.ONE);
			gl.drawArrays(gl.TRIANGLES, table[row], table[row + 1]);

			gl.bindFramebuffer(gl.FRAMEBUFFER, picture.fbo);
			gl.useProgram(stroke);
			gl.bindTexture(gl.TEXTURE_2D, scratch.tex);
			gl.uniform1f(uAlpha, table[row + 2]);
			gl.uniform1f(uTone, table[row + 3]);
			gl.blendEquation(gl.FUNC_ADD);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			fullscreen(gl);
			gl.bindTexture(gl.TEXTURE_2D, null);
		}
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.BLEND);
		gl.blendEquation(gl.FUNC_ADD);
	}

	dispose() {
		const { gl } = this;
		this.freeTargets();
		gl.deleteVertexArray(this.arcVao);
		gl.deleteBuffer(this.arcVbo);
		gl.deleteFramebuffer(this.outFbo);
	}
}
