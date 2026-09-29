import { defineScene } from "./common";

/** A pastel nebula with a lollipop planet and drifting sprinkles, orbiting a glazed
 * donut (1), a pair of cherries (2) and two dice (3, 4). */
export const SNACK_GALAXY = defineScene(
	"snack-galaxy",
	/* glsl */ `
const vec3 PLANET = vec3(-16.0, -7.0, 22.0);

float icingLine(vec3 q) {
  float a = atan(q.z, q.x);
  return 0.02 + 0.07 * sin(a * 5.0) + 0.04 * sin(a * 11.0 + 1.3);
}

vec3 donutLocal(vec3 p) {
  vec3 q = p - vec3(0.0, 0.25 + 0.15 * sin(T * 0.8), 0.0);
  q.yz *= rot(0.9 + 0.2 * sin(T * 0.3));
  q.xz *= rot(T * 0.35);
  return q;
}

float donut(vec3 p) {
  vec3 q = donutLocal(p);
  float d = sdTorus(q, vec2(0.95, 0.46));
  return d - 0.04 * smoothstep(-0.02, 0.02, q.y - icingLine(q));
}

vec3 cherryLocal(vec3 p) {
  vec3 q = p - vec3(-2.3, -0.5 + 0.2 * sin(T * 0.7 + 1.0), 0.9);
  q.xy *= rot(0.3 * sin(T * 0.5));
  q.xz *= rot(T * 0.4);
  return q;
}

float cherries(vec3 p) {
  vec3 q = cherryLocal(p);
  vec3 a = vec3(-0.3, -0.15, 0.0);
  vec3 b = vec3(0.32, -0.3, 0.12);
  float fruit = min(sdSphere(q - a, 0.34), sdSphere(q - b, 0.32));
  // The dimple where each stem goes in.
  fruit = smax(fruit, -min(sdSphere(q - a - vec3(0.0, 0.36, 0.0), 0.08), sdSphere(q - b - vec3(0.0, 0.34, 0.0), 0.08)), 0.05);
  vec3 top = vec3(0.1, 0.95, 0.05);
  vec3 kneeA = vec3(-0.22, 0.55, 0.0);
  vec3 kneeB = vec3(0.3, 0.45, 0.08);
  float stems = min(
    min(sdCapsule(q, a + vec3(0.0, 0.3, 0.0), kneeA, 0.025), sdCapsule(q, kneeA, top, 0.025)),
    min(sdCapsule(q, b + vec3(0.0, 0.28, 0.0), kneeB, 0.025), sdCapsule(q, kneeB, top, 0.025)));
  float leaf = sdEllipsoid(q - top - vec3(0.18, 0.02, 0.0), vec3(0.2, 0.03, 0.09));
  return min(fruit, min(stems, leaf));
}

vec3 diceLocal(vec3 p, float i) {
  vec3 q = p - (i == 3.0
    ? vec3(2.0, 1.0 + 0.2 * sin(T * 0.9), -0.6)
    : vec3(1.7, -1.2 + 0.2 * sin(T * 0.8 + 2.0), 1.3));
  q.xy *= rot(T * (i == 3.0 ? 0.5 : -0.4));
  q.yz *= rot(T * (i == 3.0 ? 0.37 : 0.45) + i);
  return q;
}

float dice(vec3 p, float i) {
  return sdRoundBox(diceLocal(p, i), vec3(0.4), 0.09);
}

const float CELL = 3.5;

float sprinkles3d(vec3 p) {
  if (length(p) < 4.0) return 1.0;
  vec3 cell = floor(p / CELL);
  vec3 q = mod(p, CELL) - CELL * 0.5;
  // Past this, a neighbour's sprinkle can't be nearer than the cell wall.
  float wall = CELL * 0.5 - max(abs(q.x), max(abs(q.y), abs(q.z))) + 0.7;
  vec3 h = vec3(hash22(cell.xy + cell.z * 7.1), hash21(cell.zx + 3.3));
  if (h.z < 0.5) return wall;
  q -= (vec3(hash22(cell.yz + 1.7), h.z) - 0.5) * 1.0;
  q.xy *= rot(h.x * 6.28 + T * 0.3);
  q.yz *= rot(h.y * 6.28);
  return min(wall, sdCapsule(q, vec3(-0.15, 0.0, 0.0), vec3(0.15, 0.0, 0.0), 0.05));
}

vec2 map(vec3 p) {
  vec2 res = vec2(min(sdSphere(p - PLANET, 8.0), sprinkles3d(p) * 0.8), 0.0);
  if (withElements()) {
    res = nearest(res, vec2(donut(p), 1.0));
    res = nearest(res, vec2(cherries(p), 2.0));
    res = nearest(res, vec2(dice(p, 3.0), 3.0));
    res = nearest(res, vec2(dice(p, 4.0), 4.0));
  }
  return res;
}

vec3 sky(vec3 rd) {
  vec3 col = mix(vec3(1.0, 0.78, 0.72), vec3(0.6, 0.55, 0.96), smoothstep(-0.5, 0.6, rd.y));
  float n = fbm(rd.xy / (abs(rd.z) + 0.6) * 1.6 + T * 0.02);
  col = mix(col, vec3(1.0, 0.6, 0.85), smoothstep(0.45, 0.8, n) * 0.55);
  col = mix(col, vec3(0.6, 0.95, 0.9), smoothstep(0.55, 0.9, fbm(rd.zy * 2.0 + 4.0)) * 0.4);
  return col;
}

float pipDist(vec2 f, float n) {
  float s = 0.2;
  float d = 1e5;
  if (mod(n, 2.0) == 1.0) d = length(f);
  if (n >= 2.0) d = min(d, min(length(f - vec2(-s, -s)), length(f - vec2(s, s))));
  if (n >= 4.0) d = min(d, min(length(f - vec2(-s, s)), length(f - vec2(s, -s))));
  if (n == 6.0) d = min(d, min(length(f - vec2(-s, 0.0)), length(f - vec2(s, 0.0))));
  return d;
}

float sprinkleCell(vec3 q, out vec3 color) {
  vec2 g = vec2(atan(q.z, q.x) * 7.0, atan(q.y, length(q.xz) - 0.95) * 3.0);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 h = hash22(cell);
  f *= rot(h.x * 6.28);
  float on = step(0.35, h.y);
  int k = int(floor(h.x * 5.0));
  color = k == 0 ? vec3(1.0, 0.95, 0.4) : k == 1 ? vec3(0.4, 0.85, 1.0) : k == 2 ? vec3(1.0, 1.0, 1.0) : k == 3 ? vec3(0.5, 1.0, 0.6) : vec3(1.0, 0.45, 0.35);
  return on * step(abs(f.x), 0.28) * step(abs(f.y), 0.08);
}

vec3 material(vec3 p, vec3 n, float id, out float gloss) {
  gloss = 0.3;
  if (id < 0.5) {
    if (length(p - PLANET) < 8.2) {
      vec3 q = normalize(p - PLANET);
      float swirl = sin(atan(q.x, q.z) * 3.0 + q.y * 10.0 + T * 0.3);
      return mix(vec3(1.0, 0.55, 0.75), vec3(1.0, 0.97, 0.93), step(0.0, swirl));
    }
    vec3 cell = floor(p / CELL);
    float h = hash21(cell.xy + cell.z * 7.1);
    gloss = 0.6;
    return h < 0.33 ? vec3(1.0, 0.5, 0.7) : h < 0.66 ? vec3(0.5, 0.9, 1.0) : vec3(1.0, 0.95, 0.5);
  }
  if (id < 1.5) {
    vec3 q = donutLocal(p);
    if (q.y > icingLine(q)) {
      gloss = 0.9;
      vec3 sprinkle;
      float s = sprinkleCell(q, sprinkle);
      return mix(vec3(1.0, 0.45, 0.72), sprinkle, s);
    }
    return mix(vec3(0.85, 0.55, 0.3), vec3(0.95, 0.72, 0.45), smoothstep(-0.3, 0.1, q.y));
  }
  if (id < 2.5) {
    vec3 q = cherryLocal(p);
    gloss = 1.0;
    if (q.y > 0.1) return q.y > 0.9 ? vec3(0.3, 0.75, 0.25) : vec3(0.4, 0.3, 0.15);
    return vec3(0.85, 0.05, 0.12);
  }
  vec3 q = diceLocal(p, id);
  vec3 a = abs(q);
  float face;
  vec2 f;
  if (a.x > a.y && a.x > a.z) { face = q.x > 0.0 ? 1.0 : 6.0; f = q.yz; }
  else if (a.y > a.z) { face = q.y > 0.0 ? 2.0 : 5.0; f = q.xz; }
  else { face = q.z > 0.0 ? 3.0 : 4.0; f = q.xy; }
  gloss = 0.7;
  vec3 body = id < 3.5 ? vec3(1.0, 0.97, 0.95) : vec3(0.55, 0.95, 0.8);
  vec3 pip = id < 3.5 ? vec3(0.95, 0.25, 0.5) : vec3(0.25, 0.3, 0.6);
  return mix(body, pip, smoothstep(0.085, 0.07, pipDist(f, face)));
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  float a = T * 0.14;
  vec3 ro = vec3(6.8 * sin(a), 1.0 + 0.6 * sin(T * 0.2), -6.8 * cos(a));
  vec3 rd = cameraRay(uv, aspect, ro, vec3(0.0, 0.0, 0.0), 1.6, 0.08 * sin(T * 0.25));
  vec2 h = march(ro, rd, 60.0, 0.9);
  vec3 col = sky(rd);
  if (h.x < 60.0) {
    vec3 p = ro + rd * h.x;
    vec3 n = calcNormal(p);
    float gloss;
    vec3 base = material(p, n, h.y, gloss);
    vec3 key = normalize(vec3(0.6, 0.8, -0.4));
    float dif = max(dot(n, key), 0.0);
    float fill = 0.5 + 0.5 * n.y;
    vec3 r = reflect(rd, n);
    float spec = pow(max(dot(r, key), 0.0), 40.0) * gloss;
    float fre = fresnel(n, rd, 3.0);
    col = base * (vec3(1.0, 0.95, 0.9) * dif * 0.85 + vec3(0.55, 0.5, 0.75) * fill * 0.45);
    col += spec * 0.9 + sky(r) * fre * 0.35 * gloss + vec3(1.0, 0.6, 0.8) * fre * 0.15;
    col = mix(col, sky(rd), 1.0 - exp(-max(h.x - 12.0, 0.0) * 0.03));
  }
  col += sparkles(uv * vec2(aspect, 1.0), 30.0, 0.05, vec2(T * 0.01, 0.0)) * 0.6;
  return vec4(col, h.x < 60.0 ? h.y : 0.0);
}
`,
);
