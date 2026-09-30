import type { SceneDef } from "../../gl/scene-pass";

/** Helpers the flat worlds share: no marching, a few shapes per pixel, for
 * devices the 3D worlds are too heavy for. A world defines
 * `vec4 world(vec2 uv, float aspect, float time)` and sets `T` first thing. */
const COMMON = /* glsl */ `
float T;

#define ZERO min(int(u_time), 0)

const float PI = 3.14159265;
const float TAU = 6.28318531;

bool withElements() {
  return u_withElements > 0.5;
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

/** Centred with y up, 1 tall and aspect wide. */
vec2 centred(vec2 uv, float aspect) {
  return (uv - 0.5) * vec2(aspect, 1.0);
}

/** One twinkling star per lit cell. */
float stars(vec2 p, float density, float size) {
  vec2 g = p * density;
  vec2 cell = floor(g);
  vec2 off = (hash22(cell) - 0.5) * 0.6;
  float lit = step(0.9, hash21(cell + 3.7));
  float twinkle = 0.55 + 0.45 * sin(T * 3.0 + hash21(cell) * 40.0);
  return lit * twinkle * smoothstep(size, 0.0, length(fract(g) - 0.5 - off));
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

/** 1 on the lines of a unit grid, antialiased by the screen footprint. */
float gridLines(vec2 g, float width) {
  vec2 d = abs(fract(g) - 0.5);
  vec2 fw = fwidth(g);
  vec2 l = smoothstep(vec2(0.5 - width) - fw, vec2(0.5 - width), d);
  return max(l.x, l.y);
}
`;

export function defineFlatScene(id: string, frag: string): SceneDef {
	return { id, frag: COMMON + frag };
}
