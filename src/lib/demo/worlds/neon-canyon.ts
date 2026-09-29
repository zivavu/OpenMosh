import { defineScene } from "./common";

/** A flight down a winding neon canyon toward a striped sun, with four objects
 * riding along: chrome metaballs (1), a crystal (2), a box frame (3) and a ring
 * gate (4). */
export const NEON_CANYON = defineScene(
	"neon-canyon",
	/* glsl */ `
float camZ;

float centerX(float z) {
  return 1.6 * sin(z * 0.09) + 0.6 * sin(z * 0.23 + 1.3);
}

const float FLOOR_Y = -1.2;

// Terraced walls that step outward going up, mesas on top, a flat floor.
float rock(vec3 p) {
  float x = p.x - centerX(p.z);
  float terrace = floor(max(p.y - FLOOR_Y, 0.0) * 1.3) / 1.3;
  float halfW = 2.9 + 0.7 * sin(p.z * 0.17) + 0.35 * sin(p.z * 0.41 + 2.0)
    + terrace * 0.45;
  float open = halfW - abs(x) + 0.12 * sin(p.z * 1.7 + p.y * 3.0);
  float top = 3.4 + 0.9 * sin(p.z * 0.11 + sign(x) * 1.7);
  return min(max(open, p.y - top), p.y - FLOOR_Y);
}

const float GATE_AHEAD = 22.0;
vec3 SUN;

// Down the canyon, so the bends swing it across the sky.
vec3 sunDir() {
  return SUN;
}

vec3 riding(float ahead) {
  float z = camZ + ahead;
  return vec3(centerX(z), 0.0, z);
}

vec2 elements(vec3 p) {
  vec2 res = vec2(1e5, 0.0);
  vec3 q = p - riding(7.0) - vec3(0.35, 0.05 + 0.15 * sin(T * 0.9), 0.0);
  float d = length(q - 0.7 * vec3(sin(T * 1.1), 0.4 * sin(T * 1.7), cos(T * 1.1))) - 0.38;
  d = smin(d, length(q - 0.75 * vec3(cos(T * 0.8 + 2.0), sin(T * 1.3), sin(T * 0.8 + 2.0))) - 0.3, 0.35);
  d = smin(d, length(q) - 0.34, 0.35);
  if (d < res.x) res = vec2(d, 1.0);

  q = p - riding(9.0) - vec3(-1.7, 0.9 + 0.2 * sin(T * 0.7 + 1.0), 0.0);
  q.xz *= rot(T * 0.6);
  q.xy *= rot(0.3);
  d = sdOctahedron(vec3(q.x, q.y / 1.7, q.z), 0.55);
  if (d < res.x) res = vec2(d, 2.0);

  q = p - riding(10.0) - vec3(1.8, 1.3 + 0.2 * sin(T * 0.8 + 2.5), 0.0);
  q.xy *= rot(T * 0.5);
  q.yz *= rot(T * 0.7);
  d = sdBoxFrame(q, vec3(0.5), 0.06);
  if (d < res.x) res = vec2(d, 3.0);

  // On the line to the sun, so it frames it.
  q = p - vec3(centerX(camZ + GATE_AHEAD), 0.3 + GATE_AHEAD * SUN.y / SUN.z, camZ + GATE_AHEAD);
  q.xz *= rot(0.25 * sin(T * 0.3));
  float notch = 0.06 * sin(atan(q.y, q.x) * 12.0 + T * 2.0);
  d = (sdTorus(q.xzy, vec2(3.0, 0.18 + notch))) * 0.8;
  if (d < res.x) res = vec2(d, 4.0);
  return res;
}

vec2 map(vec3 p) {
  vec2 res = vec2(rock(p), 0.0);
  if (u_withElements > 0.5) {
    vec2 e = elements(p);
    if (e.x < res.x) res = e;
  }
  return res;
}

vec3 sky(vec3 rd) {
  vec3 col = mix(vec3(1.0, 0.25, 0.45), vec3(0.08, 0.02, 0.16), smoothstep(-0.05, 0.4, rd.y));
  col = mix(col, vec3(0.01, 0.005, 0.03), smoothstep(0.4, 0.9, rd.y));
  vec2 g = floor(vec2(atan(rd.x, rd.z), rd.y) * 160.0);
  col += step(0.995, hash21(g)) * smoothstep(0.2, 0.5, rd.y) * 0.9;
  if (rd.z > 0.0) {
    vec3 s = sunDir();
    vec2 sp = rd.xy / rd.z - s.xy / s.z;
    float r = length(sp);
    float disc = smoothstep(0.11, 0.105, r);
    // Synthwave slits, thickening toward the horizon.
    float cut = sp.y > 0.03
      ? 1.0
      : step(mix(0.08, 0.7, clamp((0.03 - sp.y) / 0.14, 0.0, 1.0)), fract(sp.y * 40.0 + T * 0.25));
    vec3 sunCol = mix(vec3(1.0, 0.15, 0.5), vec3(1.0, 0.85, 0.3), smoothstep(-0.11, 0.11, sp.y));
    col = mix(col, sunCol * 1.3, disc * cut);
    col += vec3(1.0, 0.3, 0.5) * 0.5 * exp(-r * 6.0);
  }
  return col;
}

// What chrome reflects: the sky above, a grid floor below.
vec3 env(vec3 r) {
  if (r.y > 0.0) return sky(r);
  vec2 f = abs(fract(r.xz / -r.y * 1.5) - 0.5);
  float line = smoothstep(0.42, 0.5, max(f.x, f.y));
  return vec3(0.04, 0.01, 0.07) + line * vec3(0.9, 0.2, 0.9) * exp(r.y * 2.5);
}

vec3 shade(vec3 p, vec3 rd, vec3 n, float id, float t) {
  vec3 s = sunDir();
  float fre = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
  if (id > 0.5) {
    vec3 r = reflect(rd, n);
    vec3 e = env(r);
    float spec = pow(max(dot(r, s), 0.0), 40.0) * 2.0;
    vec3 col;
    if (id < 1.5) {
      col = e * vec3(0.95, 0.9, 1.0) + vec3(0.35, 0.25, 0.5) * 0.25 + spec;
    } else if (id < 2.5) {
      vec3 irid = 0.5 + 0.5 * cos(6.2831 * (fre * 1.5 + vec3(0.0, 0.33, 0.67)) + T);
      col = e * 0.35 + irid * (0.35 + fre) + vec3(0.9, 0.1, 0.5) * 0.3 + spec;
    } else if (id < 3.5) {
      col = e * vec3(0.3, 0.9, 1.0) * 0.6 + vec3(0.1, 0.85, 1.0) * 0.7;
    } else {
      col = vec3(1.0, 0.5, 0.18) * 1.5 + e * 0.3;
    }
    return col + fre * 0.35;
  }
  if (p.y < FLOOR_Y + 0.02) {
    vec2 f = abs(fract(vec2(p.x - centerX(p.z), p.z)) - 0.5);
    float line = smoothstep(0.44, 0.5, max(f.x, f.y));
    vec3 neon = mix(vec3(0.1, 0.9, 1.0), vec3(1.0, 0.2, 0.7), 0.5 + 0.5 * sin(p.z * 0.2));
    vec3 col = vec3(0.03, 0.01, 0.05) + line * neon * 1.4 * exp(-t * 0.04);
    return col + vec3(1.0, 0.3, 0.5) * 0.25 * pow(max(dot(reflect(rd, n), s), 0.0), 6.0);
  }
  float band = fract((p.y - FLOOR_Y) * 1.3);
  vec3 base = mix(vec3(0.16, 0.04, 0.22), vec3(0.34, 0.07, 0.26), smoothstep(0.2, 0.8, band));
  vec3 key = normalize(vec3(-0.5, 0.8, -0.3));
  vec3 col = base * (0.25 + 0.9 * max(dot(n, key), 0.0));
  col += vec3(1.0, 0.35, 0.5) * 0.5 * max(dot(n, s), 0.0);
  col += vec3(0.2, 0.8, 1.0) * 0.35 * fre;
  // Terrace ledges catch the neon.
  col += vec3(1.0, 0.35, 0.6) * 0.7 * smoothstep(0.5, 0.9, n.y);
  return col;
}

const float FAR = 70.0;

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  camZ = time * 2.2;
  SUN = normalize(vec3((centerX(camZ + GATE_AHEAD) - centerX(camZ)) / GATE_AHEAD, 0.08, 1.0));
  vec3 ro = vec3(centerX(camZ), 0.3 + 0.12 * sin(T * 0.4), camZ);
  vec3 ta = vec3(centerX(camZ + 6.0), 0.65, camZ + 6.0);
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(vec3(sin(T * 0.17) * 0.06, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 rd = normalize(c.x * rt + c.y * up + 1.5 * fw);

  vec2 h = march(ro, rd, FAR, 0.75);
  float t = h.x;
  if (t > FAR) return vec4(sky(rd), 0.0);
  vec3 p = ro + rd * t;
  vec3 col = shade(p, rd, calcNormal(p), h.y, t);
  col = mix(col, vec3(0.55, 0.12, 0.35), 1.0 - exp(-t * 0.035));
  return vec4(col, h.y);
}
`,
);
