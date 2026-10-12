/** GL plumbing for the generators that run their own passes (cutout, attractor,
 * ink) on the shared generator context, and the GLSL they share. */

import type { Colors } from "./palette";

type Programs = Map<string, WebGLProgram>;
const programs = new WeakMap<WebGL2RenderingContext, Programs>();
const locations = new WeakMap<
	WebGLProgram,
	Map<string, WebGLUniformLocation | null>
>();
const fullscreenVaos = new WeakMap<
	WebGL2RenderingContext,
	WebGLVertexArrayObject
>();
const accumFormats = new WeakMap<WebGL2RenderingContext, number>();

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
	const s = gl.createShader(type)!;
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(s);
		gl.deleteShader(s);
		throw new Error(`Shader compile error: ${log}`);
	}
	return s;
}

/** Compiled once per context; `feedback` names transform-feedback outputs. */
export function program(
	gl: WebGL2RenderingContext,
	vs: string,
	fs: string,
	feedback?: string[],
): WebGLProgram {
	let cache = programs.get(gl);
	if (!cache) programs.set(gl, (cache = new Map()));
	const key = vs + "\0" + fs;
	const hit = cache.get(key);
	if (hit) return hit;
	const p = gl.createProgram()!;
	const v = compile(gl, gl.VERTEX_SHADER, vs);
	const f = compile(gl, gl.FRAGMENT_SHADER, fs);
	gl.attachShader(p, v);
	gl.attachShader(p, f);
	if (feedback)
		gl.transformFeedbackVaryings(p, feedback, gl.INTERLEAVED_ATTRIBS);
	gl.linkProgram(p);
	gl.deleteShader(v);
	gl.deleteShader(f);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS))
		throw new Error(`Program link error: ${gl.getProgramInfoLog(p)}`);
	cache.set(key, p);
	return p;
}

export function loc(
	gl: WebGL2RenderingContext,
	p: WebGLProgram,
	name: string,
): WebGLUniformLocation | null {
	let m = locations.get(p);
	if (!m) locations.set(p, (m = new Map()));
	if (!m.has(name)) m.set(name, gl.getUniformLocation(p, name));
	return m.get(name)!;
}

export function hexRgb(hex: string): [number, number, number] {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function setInks(
	gl: WebGL2RenderingContext,
	p: WebGLProgram,
	colors: Colors,
) {
	colors.forEach((hex, i) =>
		gl.uniform3fv(
			loc(gl, p, `uC${i}`),
			hexRgb(hex).map((v) => v / 255),
		),
	);
}

/** Float format that takes additive blending here: 32-bit where it can, else half. */
export function accumFormat(gl: WebGL2RenderingContext): number {
	const known = accumFormats.get(gl);
	if (known !== undefined) return known;
	const full = !!gl.getExtension("EXT_color_buffer_float");
	if (!full && !gl.getExtension("EXT_color_buffer_half_float"))
		throw new Error("No float render targets for the generators");
	const format =
		full && gl.getExtension("EXT_float_blend") ? gl.RGBA32F : gl.RGBA16F;
	accumFormats.set(gl, format);
	return format;
}

export function texture(
	gl: WebGL2RenderingContext,
	w: number,
	h: number,
	internal: number,
	opts: { filter?: number; data?: Float32Array } = {},
): WebGLTexture {
	const t = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, t);
	const float = internal === gl.RGBA32F || internal === gl.RGBA16F;
	// RGBA16F takes float32 uploads too; empty targets just need a matching type.
	const type = !float
		? gl.UNSIGNED_BYTE
		: internal === gl.RGBA32F || opts.data
			? gl.FLOAT
			: gl.HALF_FLOAT;
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		internal,
		w,
		h,
		0,
		gl.RGBA,
		type,
		opts.data ?? null,
	);
	const filter = opts.filter ?? (float ? gl.NEAREST : gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MAG_FILTER,
		filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter,
	);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return t;
}

export function framebuffer(
	gl: WebGL2RenderingContext,
	tex: WebGLTexture,
): WebGLFramebuffer {
	const f = gl.createFramebuffer()!;
	gl.bindFramebuffer(gl.FRAMEBUFFER, f);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		tex,
		0,
	);
	return f;
}

export const FULLSCREEN_VS = `#version 300 es
const vec2 v[3] = vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
void main(){ gl_Position = vec4(v[gl_VertexID],0.,1.); }`;

/** One fullscreen triangle from an attribute-free VAO. */
export function fullscreen(gl: WebGL2RenderingContext) {
	let vao = fullscreenVaos.get(gl);
	if (!vao) fullscreenVaos.set(gl, (vao = gl.createVertexArray()!));
	gl.bindVertexArray(vao);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Ramp lookup, hashes and gradient noise for the generator shaders. */
export const GLSL_COMMON = `
#define PI 3.14159265359
uniform vec3 uC0,uC1,uC2,uC3,uC4;
vec3 ramp(float t){
  t=clamp(t,0.,1.)*4.;
  if(t<1.) return mix(uC0,uC1,t);
  if(t<2.) return mix(uC1,uC2,t-1.);
  if(t<3.) return mix(uC2,uC3,t-2.);
  return mix(uC3,uC4,t-3.);
}
float hash12(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z);
}
uint pcg(uint v){
  uint s=v*747796405u+2891336453u;
  uint w=((s>>((s>>28u)+4u))^s)*277803737u;
  return (w>>22u)^w;
}
float u01(uint h){ return float(h)*(1.0/4294967296.0); }
`;
