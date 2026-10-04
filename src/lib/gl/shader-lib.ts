import { hexToVec3 } from "../color";

/** GLSL snippets and uniform setters the effect shaders share. */

export const H = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_time;
in vec2 v_uv;
out vec4 outColor;
`;

export const BOUNCE_GLSL = `float bounce(float v) {
  v = mod(abs(v), 2.0);
  return v > 1.0 ? 2.0 - v : v;
}
`;

export const HASH_GLSL = `float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

export const NOISE_GLSL =
	HASH_GLSL +
	`float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 5.0) * 0.3
       + vnoise(p * 4.41 + 9.0) * 0.15;
}
`;

/** Hue/sat/value conversion, shared by the effects that reason in HSV. */
export const HSV_GLSL = `vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

export const HUE_ROTATE_GLSL = `vec3 hueRotate(vec3 c, float angle) {
  float rad = angle * 3.14159265 / 180.0;
  float cosA = cos(rad);
  float sinA = sin(rad);
  vec3 k = vec3(0.57735026919);
  return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
}
`;

export interface PrePassDef {
	fragment: string;
	/** Use LINEAR texture filtering for this pass (smoother sampling). */
	linearFilter?: boolean;
	/** Keep this pass's output as private full-res history and hand it back as
	 * u_feedback next frame, so an effect can carry state apart from the main pass's own feedback. */
	feedback?: boolean;
}

export interface EffectShaderDef {
	fragment: string;
	/** Pre-passes rendered before the main fragment (for multi-pass effects like bloom). */
	prePasses?: PrePassDef[];
	/** Sample the chain input with LINEAR filtering for the main pass (smooth warps like swirl). */
	linearFilter?: boolean;
	/** Allocate this effect's u_feedback history as half-float instead of RGBA8:
	 * simulations whose per-frame deltas fall below 8-bit quantization stall into
	 * flat blobs otherwise. */
	hdrFeedback?: boolean;
	/** This shader paints its own background over the whole frame (halftone's
	 * paper), so it can't preserve transparency. On a text layer it fills the frame. */
	opaqueOutput?: boolean;
	animated?: boolean;
	setUniforms: (
		gl: WebGL2RenderingContext,
		locs: Record<string, WebGLUniformLocation>,
		values: Record<string, number | string>,
	) => void;
}

export function setFloat(
	gl: WebGL2RenderingContext,
	locs: Record<string, WebGLUniformLocation>,
	name: string,
	value: number,
) {
	if (locs[name]) gl.uniform1f(locs[name], value);
}

export function setInt(
	gl: WebGL2RenderingContext,
	locs: Record<string, WebGLUniformLocation>,
	name: string,
	value: number,
) {
	if (locs[name]) gl.uniform1i(locs[name], value);
}

/** Parsed colors, keyed by the hex string. setUniforms runs every frame, so
 * without this each frame paid a regex, a parseInt and two array allocations per color. */
const colorVecs = new Map<string, Float32Array>();

export function colorVec(hex: string): Float32Array {
	let vec = colorVecs.get(hex);
	if (!vec) {
		vec = new Float32Array(hexToVec3(hex));
		// Dragging a color picker mints a key per step; don't grow forever.
		if (colorVecs.size > 256) colorVecs.clear();
		colorVecs.set(hex, vec);
	}
	return vec;
}

export function setColor(
	gl: WebGL2RenderingContext,
	locs: Record<string, WebGLUniformLocation>,
	name: string,
	hex: string,
) {
	if (locs[name]) gl.uniform3fv(locs[name], colorVec(hex));
}

/** Create a setUniforms that maps each key to a float uniform named u_{key}. */
export function floats(...keys: string[]): EffectShaderDef["setUniforms"] {
	return (gl, l, v) => {
		for (const key of keys) setFloat(gl, l, `u_${key}`, v[key] as number);
	};
}

/** Plain horizontal Gaussian (no threshold), Blur effect pass 1. */
export const BLUR_H_FRAG = `uniform float u_radius;
uniform vec2 u_resolution;
void main() {
  // Pixel size from the full output resolution, so blur width ignores pre-pass downsampling.
  vec2 px = 1.0 / u_resolution;
  float spread = u_radius * 3.0;
  float sigma = spread * 0.4;
  float invSigma2 = 1.0 / max(sigma * sigma, 0.001);
  vec4 sum = vec4(0.0);
  float totalW = 0.0;
  const int R = 16;
  float step = spread / float(R);
  for (int i = -R; i <= R; i++) {
    float fi = float(i) * step;
    float w = exp(-fi * fi * invSigma2);
    sum += texture(u_texture, v_uv + vec2(fi * px.x, 0.0)) * w;
    totalW += w;
  }
  outColor = sum / totalW;
}`;

export const GLOW_VBLUR_FRAG = `uniform float u_radius;
uniform vec2 u_resolution;
void main() {
  vec2 px = 1.0 / u_resolution;
  float spread = u_radius * 3.0;
  float sigma = spread * 0.4;
  float invSigma2 = 1.0 / max(sigma * sigma, 0.001);
  vec4 bloom = vec4(0.0);
  float totalW = 0.0;
  const int R = 16;
  float step = spread / float(R);
  for (int i = -R; i <= R; i++) {
    float fi = float(i) * step;
    float w = exp(-fi * fi * invSigma2);
    vec2 off = vec2(0.0, fi * px.y);
    bloom += texture(u_texture, v_uv + off) * w;
    totalW += w;
  }
  outColor = bloom / totalW;
}`;
