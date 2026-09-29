import type { SceneDef } from "../../gl/scene-pass";

/** Helpers every world shares. A world defines `vec2 map(vec3 p)` (distance, id)
 * and `vec4 world(vec2 uv, float aspect, float time)`, and sets `T` first thing. */
const COMMON = /* glsl */ `
float T;
vec2 map(vec3 p);

// Loops start here, not at 0: a bound the compiler can't see through keeps
// Direct3D from unrolling and inlining every one, which takes seconds to build.
#define ZERO min(int(u_time), 0)

const float PI = 3.14159265;
const float TAU = 6.28318531;

bool withElements() {
  return u_withElements > 0.5;
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
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

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  return mix(
    mix(mix(hash11(n), hash11(n + 1.0), u.x), mix(hash11(n + 57.0), hash11(n + 58.0), u.x), u.y),
    mix(mix(hash11(n + 113.0), hash11(n + 114.0), u.x), mix(hash11(n + 170.0), hash11(n + 171.0), u.x), u.y),
    u.z);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = ZERO; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = ZERO; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  return sdBox(p, b - r) - r;
}

float sdTorus(vec3 p, vec2 t) {
  return length(vec2(length(p.xz) - t.x, p.y)) - t.y;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

/** A capsule whose radius runs from ra at a to rb at b. */
float sdTaper(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

float sdCylinder(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/** Centred on the origin, y from -h to h; r1 the bottom radius, r2 the top. */
float sdCappedCone(vec3 p, float h, float r1, float r2) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h);
  vec2 k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, q.y < 0.0 ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027;
}

float sdHexPrism(vec3 p, vec2 h) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  vec2 d = vec2(length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x), p.z - h.y);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdBoxFrame(vec3 p, vec3 b, float e) {
  p = abs(p) - b;
  vec3 q = abs(p + e) - e;
  return min(min(
    length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
    length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
    length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}

/** Keeps the nearer of two (distance, id) hits. */
vec2 nearest(vec2 a, vec2 b) {
  return a.x < b.x ? a : b;
}

vec3 cameraRay(vec2 uv, float aspect, vec3 ro, vec3 ta, float lens, float roll) {
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(vec3(sin(roll), cos(roll), 0.0), fw));
  vec3 up = cross(fw, rt);
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  return normalize(c.x * rt + c.y * up + lens * fw);
}

/** (distance travelled, id); the distance is past far on a miss. */
vec2 march(vec3 ro, vec3 rd, float far, float stepScale) {
  float t = 0.02;
  float id = 0.0;
  for (int i = ZERO; i < 128; i++) {
    vec2 h = map(ro + rd * t);
    id = h.y;
    if (abs(h.x) < 0.0012 * t) break;
    t += h.x * stepScale;
    if (t > far) break;
  }
  return vec2(t, id);
}

vec3 calcNormal(vec3 p) {
  vec3 n = vec3(0.0);
  for (int i = ZERO; i < 4; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += e * map(p + e * 0.0015).x;
  }
  return normalize(n);
}

float softShadow(vec3 ro, vec3 rd, float tmax, float k) {
  float res = 1.0;
  float t = 0.03;
  for (int i = ZERO; i < 28; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, k * h / t);
    t += clamp(h, 0.03, 0.5);
    if (res < 0.01 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float w = 1.0;
  for (int i = ZERO; i < 4; i++) {
    float h = 0.06 * float(i + 1);
    occ += (h - map(p + n * h).x) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 2.0 * occ, 0.0, 1.0);
}

float fresnel(vec3 n, vec3 rd, float power) {
  return pow(1.0 - max(dot(n, -rd), 0.0), power);
}

/** A thin glowing sparkle per cell, for dust, snow, embers and stars drawn in screen space. */
float sparkles(vec2 uv, float density, float size, vec2 drift) {
  vec2 p = uv * density + drift;
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  vec2 off = hash22(cell) - 0.5;
  float on = step(0.55, hash21(cell + 7.3));
  float d = length(f - off * 0.7);
  return on * smoothstep(size, 0.0, d);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

export function defineScene(id: string, frag: string): SceneDef {
	return { id, frag: COMMON + frag };
}
