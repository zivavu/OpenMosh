import { defineScene } from "./common";

/** Adrift past a ringed gas giant: a tumbling astronaut (1), a satellite (2) and
 * a cratered asteroid (3), in a field of rocks under a nebula. */
export const DEEP_SPACE = defineScene(
	"deep-space",
	/* glsl */ `
vec3 RO;
const vec3 SUN = vec3(-0.75, 0.35, 0.55);
const vec3 PLANET = vec3(60.0, -14.0, 120.0);
const float PLANET_R = 45.0;

float rock(vec3 q, float r, float seed) {
  float d = length(q) - r;
  return d + (noise3(q * 2.2 / r + seed) - 0.5) * 0.35 * r + (noise3(q * 5.0 / r + seed) - 0.5) * 0.08 * r;
}

const float FIELD = 7.0;

float field(vec3 p) {
  vec3 cell = floor(p / FIELD);
  vec3 q = mod(p, FIELD) - FIELD * 0.5;
  float wall = FIELD * 0.5 - max(abs(q.x), max(abs(q.y), abs(q.z))) + 1.0;
  float h = hash21(cell.xy + cell.z * 5.3);
  // The middle stays clear for the elements and the camera's orbit.
  if (h < 0.78 || length((cell + 0.5) * FIELD) < 11.0) return wall;
  q -= (vec3(hash22(cell.yz), hash21(cell.zx)) - 0.5) * 2.0;
  q.xy *= rot(T * 0.1 * (h - 0.5));
  return min(wall, rock(q, 0.35 + h * 0.9, h * 10.0) * 0.8);
}

vec3 astroLocal(vec3 p) {
  vec3 q = p - vec3(0.0, 0.2 * sin(T * 0.4), 0.0);
  q.xy *= rot(0.35 * sin(T * 0.21));
  q.yz *= rot(T * 0.18);
  q.xz *= rot(0.6);
  return q;
}

float astronaut(vec3 p) {
  vec3 q = astroLocal(p);
  float torso = sdRoundBox(q, vec3(0.33, 0.4, 0.22), 0.12);
  float helmet = sdSphere(q - vec3(0.0, 0.66, 0.02), 0.31);
  float pack = sdRoundBox(q - vec3(0.0, 0.08, 0.3), vec3(0.28, 0.36, 0.13), 0.06);
  float d = min(smin(torso, helmet, 0.08), pack);
  float wave = sin(T * 1.3) * 0.4;
  vec3 f = vec3(abs(q.x), q.y, q.z);
  // Left arm waves; the right floats.
  vec3 elbowL = vec3(-0.62, 0.45 + wave * 0.3, -0.1);
  vec3 handL = elbowL + vec3(-0.12, 0.35 + wave * 0.2, -0.15);
  d = min(d, sdCapsule(q, vec3(-0.35, 0.3, 0.0), elbowL, 0.1));
  d = min(d, sdCapsule(q, elbowL, handL, 0.09));
  d = min(d, sdSphere(q - handL, 0.1));
  vec3 elbowR = vec3(0.6, 0.05, -0.15);
  d = min(d, sdCapsule(q, vec3(0.35, 0.3, 0.0), elbowR, 0.1));
  d = min(d, sdCapsule(q, elbowR, vec3(0.55, -0.3, -0.35), 0.09));
  float kick = sin(T * 0.9) * 0.15;
  d = min(d, sdCapsule(q, vec3(-0.15, -0.45, 0.0), vec3(-0.22, -1.0, -0.1 + kick), 0.12));
  d = min(d, sdCapsule(q, vec3(0.15, -0.45, 0.0), vec3(0.25, -0.95, 0.15 - kick), 0.12));
  d = min(d, sdRoundBox(q - vec3(-0.22, -1.1, -0.18 + kick), vec3(0.1, 0.07, 0.16), 0.05));
  d = min(d, sdRoundBox(q - vec3(0.25, -1.05, 0.07 - kick), vec3(0.1, 0.07, 0.16), 0.05));
  return d;
}

vec3 satLocal(vec3 p) {
  vec3 q = p - vec3(2.6, 1.1 + 0.2 * sin(T * 0.5), -1.2);
  q.xz *= rot(T * 0.25);
  q.xy *= rot(0.3);
  return q;
}

float satellite(vec3 p) {
  vec3 q = satLocal(p);
  float body = sdBox(q, vec3(0.38, 0.45, 0.38)) - 0.02;
  vec3 w = vec3(abs(q.x), q.y, q.z);
  float arm = sdCapsule(w, vec3(0.38, 0.0, 0.0), vec3(0.65, 0.0, 0.0), 0.03);
  float panel = sdBox(w - vec3(1.55, 0.0, 0.0), vec3(0.9, 0.015, 0.45));
  vec3 dq = q - vec3(0.0, 0.62, 0.0);
  float dish = max(abs(length(dq - vec3(0.0, 0.5, 0.0)) - 0.62) - 0.015, dq.y - 0.18);
  float antenna = sdCapsule(q, vec3(0.0, 0.5, 0.0), vec3(0.0, 1.2, 0.0), 0.012);
  return min(min(body, min(arm, panel)), min(dish, antenna));
}

vec3 asteroidPos() {
  return vec3(-3.6, -1.1, 1.8);
}

float asteroid(vec3 p) {
  vec3 q = p - asteroidPos();
  q.xz *= rot(T * 0.12);
  q.xy *= rot(T * 0.07);
  float d = rock(q, 1.25, 3.0);
  for (int i = ZERO; i < 4; i++) {
    float fi = float(i);
    vec3 c = normalize(vec3(hash11(fi) - 0.5, hash11(fi + 4.0) - 0.5, hash11(fi + 9.0) - 0.5)) * 1.35;
    d = smax(d, -(length(q - c) - 0.35 - 0.1 * hash11(fi + 2.0)), 0.1);
  }
  return d;
}

vec2 map(vec3 p) {
  vec2 res = vec2(field(p), 0.0);
  if (withElements()) {
    res = nearest(res, vec2(astronaut(p), 1.0));
    res = nearest(res, vec2(satellite(p), 2.0));
    res = nearest(res, vec2(asteroid(p), 3.0));
  }
  return res;
}

vec3 space(vec3 rd) {
  vec3 s = normalize(SUN);
  vec3 col = vec3(0.005, 0.005, 0.02);
  float n = fbm(rd.xy * 2.0 / (1.2 + rd.z) + 3.0);
  float m = fbm(rd.yz * 2.5 + 7.0);
  col += vec3(0.45, 0.1, 0.5) * smoothstep(0.45, 0.85, n) * 0.5;
  col += vec3(0.05, 0.35, 0.5) * smoothstep(0.5, 0.9, m) * 0.45;
  vec2 g = vec2(atan(rd.x, rd.z), asin(clamp(rd.y, -1.0, 1.0))) * 120.0;
  float star = step(0.992, hash21(floor(g))) * hash21(floor(g) + 1.0);
  col += vec3(0.9, 0.95, 1.0) * star;
  float sd = max(dot(rd, s), 0.0);
  col += vec3(1.0, 0.9, 0.75) * (pow(sd, 1500.0) * 8.0 + pow(sd, 40.0) * 0.35);

  // The gas giant and its rings, traced analytically.
  vec3 oc = RO - PLANET;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - PLANET_R * PLANET_R;
  float disc = b * b - c;
  float tPlanet = disc > 0.0 ? -b - sqrt(disc) : 1e9;
  vec3 ringN = normalize(vec3(0.15, 1.0, -0.3));
  float tRing = -dot(oc, ringN) / dot(rd, ringN);
  if (tRing > 0.0) {
    vec3 rp = oc + rd * tRing;
    float r = length(rp) / PLANET_R;
    if (r > 1.3 && r < 2.3 && tRing < tPlanet) {
      float bands = 0.5 + 0.5 * sin(r * 60.0) * sin(r * 23.0);
      float alpha = smoothstep(1.3, 1.4, r) * smoothstep(2.3, 2.1, r) * (0.35 + 0.5 * bands);
      col = mix(col, vec3(0.95, 0.8, 0.6) * (0.6 + 0.4 * bands), alpha * 0.85);
    }
  }
  if (tPlanet < 1e8) {
    vec3 pp = oc + rd * tPlanet;
    vec3 pn = normalize(pp);
    float lat = pn.y + 0.08 * fbm(vec2(pn.x * 3.0 + T * 0.01, pn.y * 20.0));
    vec3 band = mix(vec3(0.85, 0.55, 0.3), vec3(0.98, 0.88, 0.7), 0.5 + 0.5 * sin(lat * 26.0));
    band = mix(band, vec3(0.7, 0.35, 0.2), smoothstep(0.6, 0.9, noise(vec2(lat * 40.0, pn.x * 4.0))) * 0.5);
    float lit = max(dot(pn, s), 0.0);
    vec3 pc = band * (0.03 + lit) + vec3(0.9, 0.6, 0.4) * pow(1.0 - max(dot(pn, -rd), 0.0), 3.0) * 0.4 * lit;
    if (tRing > 0.0 && tRing < tPlanet) {
      vec3 rp = oc + rd * tRing;
      float r = length(rp) / PLANET_R;
      if (r > 1.3 && r < 2.3) pc = mix(pc, col, 0.8);
    }
    col = pc;
  }
  return col;
}

bool onVisor(vec3 p) {
  vec3 h = astroLocal(p) - vec3(0.0, 0.66, 0.02);
  return length(h) < 0.33 && h.z < -0.08 && h.y > -0.18;
}

vec3 suitColor(vec3 p) {
  vec3 q = astroLocal(p);
  if (abs(q.y + 0.05) < 0.05 && length(q.xz) < 0.5) return vec3(1.0, 0.45, 0.1);
  if (q.z > 0.17 && abs(q.y - 0.08) < 0.4) return vec3(0.8, 0.8, 0.82);
  return vec3(0.95, 0.95, 0.93);
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  float a = T * 0.1 + 2.2;
  RO = vec3(7.2 * sin(a), 1.2 + 0.8 * sin(T * 0.13), -7.2 * cos(a));
  vec3 rd = cameraRay(uv, aspect, RO, vec3(0.0, 0.0, 0.0), 1.5, 0.1 * sin(T * 0.1));
  vec2 h = march(RO, rd, 70.0, 0.9);
  vec3 col = space(rd);
  if (h.x < 70.0) {
    vec3 p = RO + rd * h.x;
    vec3 n = calcNormal(p);
    vec3 s = normalize(SUN);
    float dif = max(dot(n, s), 0.0);
    // Warm bounce from the planet, cold from deep space.
    vec3 bounce = vec3(0.5, 0.3, 0.2) * max(dot(n, normalize(PLANET - p)), 0.0) * 0.3;
    vec3 fill = vec3(0.1, 0.12, 0.22) * (0.5 + 0.5 * n.y);
    vec3 r = reflect(rd, n);
    float spec = pow(max(dot(r, s), 0.0), 30.0);
    vec3 base;
    float shine = 0.2;
    if (h.y < 0.5 || h.y > 2.5) {
      base = mix(vec3(0.25, 0.22, 0.2), vec3(0.45, 0.4, 0.36), noise3(p * 3.0));
      shine = 0.05;
    } else if (h.y < 1.5) {
      base = suitColor(p);
      shine = 0.5;
    } else {
      vec3 q = satLocal(p);
      if (abs(q.x) > 0.66 && abs(q.y) < 0.03) {
        vec2 g = abs(fract(vec2(q.x * 5.0, q.z * 5.0)) - 0.5);
        base = mix(vec3(0.1, 0.2, 0.6), vec3(0.7, 0.8, 1.0), step(0.44, max(g.x, g.y)));
        shine = 1.0;
      } else if (max(abs(q.x), max(abs(q.y), abs(q.z))) < 0.5) {
        base = vec3(0.95, 0.7, 0.25) * (0.7 + 0.5 * noise3(q * 18.0));
        shine = 0.9;
      } else {
        base = vec3(0.85);
        shine = 0.6;
      }
    }
    col = base * (dif * vec3(1.0, 0.95, 0.88) * 1.2 + fill + bounce) + spec * shine;
    // The gold visor mirrors the sky.
    if (h.y > 0.5 && h.y < 1.5 && onVisor(p)) {
      col = space(r) * vec3(1.0, 0.8, 0.45) * 1.5 + vec3(0.2, 0.14, 0.04) + spec;
    }
  }
  return vec4(col, h.x < 70.0 ? h.y : 0.0);
}
`,
);
