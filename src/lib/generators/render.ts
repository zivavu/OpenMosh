import { createProgram, getUniformLocations } from "../gl/utils";
import { FRAG_FIELD } from "./field/shader";
import { FIELD_INDEX } from "./field/spec";
import { FRAG, FRAG_BLIT, VERT, VERT_BLIT } from "./gradient/shader";
import type { GeneratedSpec } from "./types";

/** Longest side the supersampled buffer may reach. */
const MAX_HI = 6144;

type Uniforms = Record<string, WebGLUniformLocation>;

interface Ctx {
	canvas: OffscreenCanvas;
	gl: WebGL2RenderingContext;
	gradient: { prog: WebGLProgram; u: Uniforms };
	field: { prog: WebGLProgram; u: Uniforms };
	blit: { prog: WebGLProgram; u: Uniforms };
	hiTex: WebGLTexture | null;
	hiFbo: WebGLFramebuffer | null;
	hiW: number;
	hiH: number;
	maxTex: number;
}

/** One hidden context shared by every render; it is tiny and stays warm. */
let ctx: Ctx | null = null;

function getCtx(): Ctx {
	if (ctx) return ctx;
	const canvas = new OffscreenCanvas(1, 1);
	const gl = canvas.getContext("webgl2", {
		antialias: false,
		preserveDrawingBuffer: true,
		premultipliedAlpha: false,
	});
	if (!gl) throw new Error("WebGL2 unavailable for the image generators");
	const link = (fs: string, vs = VERT) => {
		const prog = createProgram(gl, vs, fs);
		return { prog, u: getUniformLocations(gl, prog) };
	};
	gl.bindVertexArray(gl.createVertexArray());
	ctx = {
		canvas,
		gl,
		gradient: link(FRAG),
		field: link(FRAG_FIELD),
		blit: link(FRAG_BLIT, VERT_BLIT),
		hiTex: null,
		hiFbo: null,
		hiW: 0,
		hiH: 0,
		maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
	};
	return ctx;
}

function ensureHi(c: Ctx, w: number, h: number) {
	if (c.hiTex && w === c.hiW && h === c.hiH) return;
	const { gl } = c;
	if (c.hiTex) gl.deleteTexture(c.hiTex);
	if (c.hiFbo) gl.deleteFramebuffer(c.hiFbo);
	c.hiTex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, c.hiTex);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		w,
		h,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		null,
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MIN_FILTER,
		gl.LINEAR_MIPMAP_LINEAR,
	);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	c.hiFbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, c.hiFbo);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		c.hiTex,
		0,
	);
	c.hiW = w;
	c.hiH = h;
}

function hex2rgb(hex: string): [number, number, number] {
	const v = parseInt(hex.slice(1), 16);
	return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Uniforms every generator shares: placement, lighting, finish, ramp. */
function setCommon(
	gl: WebGL2RenderingContext,
	u: Uniforms,
	spec: GeneratedSpec,
	w: number,
	h: number,
) {
	gl.uniform2f(u.uRes, w, h);
	gl.uniform2f(u.uOffset, spec.offset[0], spec.offset[1]);
	gl.uniform1f(u.uSeed, spec.seed);
	gl.uniform1f(u.uScale, spec.scale);
	gl.uniform1f(u.uAngle, spec.angle);
	gl.uniform1f(u.uLight, spec.light);
	gl.uniform1f(u.uContrast, spec.contrast);
	gl.uniform1f(u.uGamma, spec.gamma);
	spec.colors.forEach((hex, i) => gl.uniform3fv(u[`uC${i}`], hex2rgb(hex)));
}

/** Draw the spec onto the shared canvas at w×h, supersampled `aa`× (capped by the GPU). */
function drawSpec(
	spec: GeneratedSpec,
	w: number,
	h: number,
	aa = 3,
): OffscreenCanvas {
	const c = getCtx();
	const { gl } = c;
	const maxHi = Math.min(MAX_HI, c.maxTex);
	let ss = aa;
	const maxSide = Math.max(w, h);
	if (maxSide * ss > maxHi) ss = Math.max(maxHi / maxSide, 1);
	const hw = Math.round(w * ss);
	const hh = Math.round(h * ss);
	ensureHi(c, hw, hh);

	// pass 1: field to hi-res buffer
	gl.bindFramebuffer(gl.FRAMEBUFFER, c.hiFbo);
	gl.viewport(0, 0, hw, hh);
	if (spec.gen === "gradient") {
		const { prog, u } = c.gradient;
		gl.useProgram(prog);
		setCommon(gl, u, spec, hw, hh);
		gl.uniform1f(u.uWarp, spec.warp);
		gl.uniform1f(u.uSpread, spec.spread);
		gl.uniform1f(u.uThresh, spec.thresh);
		gl.uniform1f(u.uSoft, spec.soft);
		gl.uniform1i(u.uMode, spec.mode);
	} else {
		const { prog, u } = c.field;
		gl.useProgram(prog);
		setCommon(gl, u, spec, hw, hh);
		gl.uniform1f(u.uCycles, spec.cycles);
		gl.uniform4fv(u.uParams, spec.params);
		gl.uniform1i(u.uField, FIELD_INDEX[spec.field]);
		gl.uniform1i(u.uDomain, spec.domain);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 3);

	// mip chain = successive box downsamples
	gl.bindTexture(gl.TEXTURE_2D, c.hiTex);
	gl.generateMipmap(gl.TEXTURE_2D);

	// pass 2: resolve + grain to canvas
	if (c.canvas.width !== w || c.canvas.height !== h) {
		c.canvas.width = w;
		c.canvas.height = h;
	}
	const { prog, u } = c.blit;
	gl.useProgram(prog);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, w, h);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, c.hiTex);
	gl.uniform1i(u.uTex, 0);
	gl.uniform1f(u.uLod, Math.log2(hw / w));
	gl.uniform1f(u.uGrain, spec.grain);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
	return c.canvas;
}

/** Render any spec to an encoded blob. PNG keeps the ramps clean; JPEG is for
 * throwaway re-renders where encode time matters more. */
export function renderSpec(
	spec: GeneratedSpec,
	width: number,
	height: number,
	type: "image/png" | "image/jpeg" = "image/png",
	aa = 3,
): Promise<Blob> {
	const canvas = drawSpec(spec, width, height, aa);
	return canvas.convertToBlob(
		type === "image/jpeg" ? { type, quality: 0.95 } : { type },
	);
}
