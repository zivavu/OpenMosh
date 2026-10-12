// One WebGL2 context shared by the GPU generators, plus the GLSL they share.

import { hexRgb, type Colors, type Env } from "./kit";

export interface Gl {
	canvas: HTMLCanvasElement;
	gl: WebGL2RenderingContext;
	/** Internal format for float targets that get additive blending. */
	accumFormat: number;
}

let shared: Gl | null = null;

export function getGl(): Gl {
	if (shared) return shared;
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl2", {
		preserveDrawingBuffer: true,
		antialias: false,
		premultipliedAlpha: false,
	});
	if (!gl) throw new Error("WebGL2 unavailable");
	const float = !!gl.getExtension("EXT_color_buffer_float");
	const half = float || !!gl.getExtension("EXT_color_buffer_half_float");
	if (!half) throw new Error("No float render targets on this GPU");
	// 32-bit blending needs its own extension; half floats blend wherever they render.
	const blend32 = float && !!gl.getExtension("EXT_float_blend");
	shared = { canvas, gl, accumFormat: blend32 ? gl.RGBA32F : gl.RGBA16F };
	return shared;
}

/** Size the shared canvas and target it. */
export function begin(w: number, h: number): Gl {
	const g = getGl();
	if (g.canvas.width !== w || g.canvas.height !== h) {
		g.canvas.width = w;
		g.canvas.height = h;
	}
	g.gl.bindFramebuffer(g.gl.FRAMEBUFFER, null);
	g.gl.viewport(0, 0, w, h);
	return g;
}

/** Copy the shared canvas onto the lab's output; this also waits for the GPU. */
export function present(env: Env) {
	env.ctx.drawImage(getGl().canvas, 0, 0);
}

const programs = new Map<string, WebGLProgram>();
const locations = new Map<
	WebGLProgram,
	Map<string, WebGLUniformLocation | null>
>();

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
	const s = gl.createShader(type)!;
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
		throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
	return s;
}

export function program(
	gl: WebGL2RenderingContext,
	vs: string,
	fs: string,
	feedback?: string[],
): WebGLProgram {
	const key = vs + "\0" + fs;
	const hit = programs.get(key);
	if (hit) return hit;
	const p = gl.createProgram()!;
	gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
	gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
	if (feedback)
		gl.transformFeedbackVaryings(p, feedback, gl.INTERLEAVED_ATTRIBS);
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS))
		throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
	programs.set(key, p);
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

export function setInks(
	gl: WebGL2RenderingContext,
	p: WebGLProgram,
	inks: Colors,
) {
	inks.forEach((c, i) =>
		gl.uniform3fv(
			loc(gl, p, `uC${i}`),
			hexRgb(c).map((v) => v / 255),
		),
	);
}

export function rgb01(hex: string): [number, number, number] {
	const [r, g, b] = hexRgb(hex);
	return [r / 255, g / 255, b / 255];
}

export function texture(
	gl: WebGL2RenderingContext,
	w: number,
	h: number,
	internal: number,
	opts: { filter?: number; data?: ArrayBufferView | null } = {},
): WebGLTexture {
	const t = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, t);
	const float = internal === gl.RGBA32F || internal === gl.RGBA16F;
	// RGBA16F takes float32 uploads too; empty targets just need a matching type.
	const type = !float
		? gl.UNSIGNED_BYTE
		: internal === gl.RGBA32F || opts.data instanceof Float32Array
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

/** Fullscreen triangle; draw with `gl.drawArrays(gl.TRIANGLES, 0, 3)` and no VAO attributes. */
export const FULLSCREEN_VS = `#version 300 es
const vec2 v[3] = vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
void main(){ gl_Position = vec4(v[gl_VertexID],0.,1.); }`;

let emptyVao: WebGLVertexArrayObject | null = null;
export function fullscreen(gl: WebGL2RenderingContext) {
	emptyVao ??= gl.createVertexArray();
	gl.bindVertexArray(emptyVao);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

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
vec2 hash22(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
// Gradient noise, roughly -1..1.
float gnoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*f*(f*(f*6.-15.)+10.);
  float a=dot(hash22(i)*2.-1., f);
  float b=dot(hash22(i+vec2(1,0))*2.-1., f-vec2(1,0));
  float c=dot(hash22(i+vec2(0,1))*2.-1., f-vec2(0,1));
  float d=dot(hash22(i+vec2(1,1))*2.-1., f-vec2(1,1));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.6;
}
uint pcg(uint v){
  uint s=v*747796405u+2891336453u;
  uint w=((s>>((s>>28u)+4u))^s)*277803737u;
  return (w>>22u)^w;
}
float u01(uint h){ return float(h)*(1.0/4294967296.0); }
`;
