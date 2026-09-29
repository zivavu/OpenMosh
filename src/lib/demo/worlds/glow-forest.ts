import { defineScene } from "./common";

/** A moonlit clearing: a cluster of glowing mushrooms (1), a snail making its
 * rounds (2), a toad (3) and a swarm of fireflies (4). */
export const GLOW_FOREST = defineScene(
	"glow-forest",
	/* glsl */ `
const vec3 GLOW = vec3(0.2, 0.95, 0.85);

float ground(vec3 p) {
  return p.y - (fbm3(p.xz * 0.6) - 0.5) * 0.35;
}

const float TREE_CELL = 3.6;

float trees(vec3 p) {
  vec2 cell = floor(p.xz / TREE_CELL);
  vec2 q = mod(p.xz, TREE_CELL) - TREE_CELL * 0.5;
  float wall = TREE_CELL * 0.5 - max(abs(q.x), abs(q.y)) + 0.9;
  vec2 centre = (cell + 0.5) * TREE_CELL;
  vec2 h = hash22(cell);
  if (length(centre) < 7.5 || h.x < 0.3) return wall;
  q -= (h - 0.5) * 1.4;
  float r = 0.3 + h.y * 0.35 + 0.04 * sin(p.y * 3.0 + h.x * 10.0);
  // Flared roots at the base.
  r += 0.25 * exp(-max(p.y, 0.0) * 2.5);
  return min(wall, length(q) - r);
}

// Distance to the whole mushroom; cap gets the distance to its cap alone.
float mushroom(vec3 q, float h, float r, float lean, inout float cap) {
  q.xy *= rot(lean);
  vec3 s = q;
  s.x -= sin(q.y * 1.8) * 0.08 * h;
  float stem = sdTaper(s, vec3(0.0), vec3(0.0, h, 0.0), r * 0.26, r * 0.16);
  float dome = sdEllipsoid(q - vec3(0.0, h, 0.0), vec3(r, r * 0.55, r));
  float c = smax(dome, -(q.y - h + 0.04), 0.05);
  cap = min(cap, c);
  return min(stem, c);
}

float cluster(vec3 p, inout float cap) {
  float d = mushroom(p, 1.25, 0.78, 0.0, cap);
  d = min(d, mushroom(p - vec3(0.85, 0.0, 0.35), 0.75, 0.46, -0.25, cap));
  d = min(d, mushroom(p - vec3(-0.65, 0.0, 0.55), 0.5, 0.36, 0.3, cap));
  d = min(d, mushroom(p - vec3(-0.2, 0.0, -0.75), 0.35, 0.24, 0.15, cap));
  return d;
}

float cluster(vec3 p) {
  float cap = 1e5;
  return cluster(p, cap);
}

vec3 snailLocal(vec3 p) {
  float a = T * 0.06;
  vec3 c = vec3(cos(a), 0.0, sin(a)) * 1.9;
  vec3 q = p - c;
  q.xz *= rot(-a - PI * 0.5);
  return q;
}

float snail(vec3 p) {
  vec3 q = snailLocal(p);
  float body = sdEllipsoid(q - vec3(0.0, 0.08, 0.0), vec3(0.16, 0.1, 0.55));
  float head = sdEllipsoid(q - vec3(0.0, 0.2, 0.45), vec3(0.11, 0.13, 0.12));
  body = smin(body, head, 0.08);
  float wave = 0.03 * sin(T * 2.0);
  float stalks = min(
    sdCapsule(q, vec3(-0.05, 0.28, 0.5), vec3(-0.12, 0.52 + wave, 0.62), 0.018),
    sdCapsule(q, vec3(0.05, 0.28, 0.5), vec3(0.12, 0.52 - wave, 0.62), 0.018));
  stalks = min(stalks, min(sdSphere(q - vec3(-0.12, 0.53 + wave, 0.62), 0.035), sdSphere(q - vec3(0.12, 0.53 - wave, 0.62), 0.035)));
  float shell = sdSphere(q - vec3(0.0, 0.34, -0.12), 0.3);
  shell = smax(shell, abs(q.x) - 0.2, 0.06);
  return min(min(body, stalks), shell);
}

vec3 toadLocal(vec3 p) {
  vec3 q = p - vec3(-1.7, 0.0, -0.4);
  q.xz *= rot(0.9);
  return q;
}

float toad(vec3 p) {
  vec3 q = toadLocal(p);
  float body = sdEllipsoid(q - vec3(0.0, 0.3, 0.0), vec3(0.42, 0.3, 0.5));
  float head = sdEllipsoid(q - vec3(0.0, 0.42, 0.38), vec3(0.34, 0.22, 0.3));
  float d = smin(body, head, 0.15);
  vec3 e = vec3(abs(q.x), q.y, q.z);
  d = smin(d, sdSphere(e - vec3(0.2, 0.6, 0.45), 0.1), 0.05);
  // Throat, puffing.
  float puff = 0.5 + 0.5 * sin(T * 3.0);
  d = smin(d, sdSphere(q - vec3(0.0, 0.26, 0.5), 0.08 + 0.12 * puff * puff), 0.06);
  d = smin(d, sdEllipsoid(e - vec3(0.36, 0.12, 0.25), vec3(0.14, 0.1, 0.25)), 0.08);
  d = smin(d, sdEllipsoid(e - vec3(0.38, 0.14, -0.3), vec3(0.18, 0.14, 0.3)), 0.08);
  return d;
}

vec3 fireflyPos(float i) {
  return vec3(
    sin(T * 0.37 + i * 2.1) * (1.6 + 0.6 * sin(i)),
    1.1 + 0.6 * sin(T * 0.5 + i * 1.3),
    cos(T * 0.29 + i * 1.7) * (1.6 + 0.6 * cos(i * 1.4)));
}

float fireflies(vec3 p) {
  float d = 1e5;
  for (int i = ZERO; i < 8; i++) d = min(d, sdSphere(p - fireflyPos(float(i)), 0.035));
  return d;
}

vec2 map(vec3 p) {
  vec2 res = vec2(min(ground(p), trees(p)), 0.0);
  if (withElements()) {
    res = nearest(res, vec2(cluster(p), 1.0));
    res = nearest(res, vec2(snail(p), 2.0));
    res = nearest(res, vec2(toad(p), 3.0));
    res = nearest(res, vec2(fireflies(p), 4.0));
  }
  return res;
}

vec3 sky(vec3 rd) {
  vec3 col = mix(vec3(0.03, 0.06, 0.1), vec3(0.01, 0.015, 0.05), smoothstep(0.0, 0.6, rd.y));
  vec3 moon = normalize(vec3(-0.5, 0.45, 0.8));
  float m = dot(rd, moon);
  col += vec3(0.8, 0.9, 1.0) * smoothstep(0.9993, 0.9996, m);
  col += vec3(0.25, 0.4, 0.55) * pow(max(m, 0.0), 60.0) * 0.6;
  return col;
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  float a = T * 0.09 + 0.6;
  vec3 ro = vec3(4.4 * sin(a), 0.9 + 0.2 * sin(T * 0.3), -4.4 * cos(a));
  vec3 rd = cameraRay(uv, aspect, ro, vec3(0.0, 0.55, 0.0), 1.45, 0.0);
  vec2 h = march(ro, rd, 40.0, 0.8);
  vec3 fogCol = vec3(0.04, 0.1, 0.12);
  vec3 col = sky(rd);
  if (h.x < 40.0) {
    vec3 p = ro + rd * h.x;
    vec3 n = calcNormal(p);
    vec3 moonDir = normalize(vec3(-0.5, 0.8, 0.6));
    float moon = max(dot(n, moonDir), 0.0);
    // The mushrooms light what's around them.
    vec3 toGlow = vec3(0.0, 1.0, 0.0) - p;
    float glow = 1.4 / (1.0 + dot(toGlow, toGlow) * 0.6) * max(dot(n, normalize(toGlow)), 0.0);
    float fre = fresnel(n, rd, 3.0);
    float ao = calcAO(p, n);
    vec3 lightCol = vec3(0.35, 0.45, 0.7) * moon * 0.55 + GLOW * glow * 0.9;
    if (h.y < 0.5) {
      bool isTree = trees(p) < ground(p);
      vec3 base = isTree
        ? vec3(0.12, 0.09, 0.08) * (0.7 + 0.3 * noise(vec2(p.y * 6.0, atan(p.x, p.z) * 8.0)))
        : mix(vec3(0.05, 0.16, 0.07), vec3(0.14, 0.24, 0.08), fbm3(p.xz * 3.0));
      col = base * (lightCol + 0.04) * ao;
      // Glowing moss specks.
      col += GLOW * 0.6 * step(0.985, hash21(floor(p.xz * 18.0))) * step(p.y, 0.3) * (0.5 + 0.5 * sin(T * 2.0 + p.x * 9.0));
    } else if (h.y < 1.5) {
      float capD = 1e5;
      cluster(p, capD);
      float capness = step(capD, 0.01) * step(-0.3, n.y);
      vec3 capCol = mix(vec3(0.1, 0.55, 0.75), GLOW, fre);
      float spots = step(0.82, noise(p.xz * 9.0 + p.y * 5.0));
      vec3 stemCol = vec3(0.75, 0.8, 0.7) * (lightCol + 0.1) + GLOW * 0.1;
      vec3 emissive = capCol * (0.55 + 0.35 * sin(T * 1.3 + p.x * 3.0)) + vec3(0.9, 1.0, 0.8) * spots * 0.6;
      // Gills on the underside glow warmer.
      if (n.y < -0.3 && capD < 0.01) emissive = vec3(1.0, 0.6, 0.4) * (0.4 + 0.3 * sin(atan(p.z, p.x) * 40.0));
      col = mix(stemCol, emissive, max(capness, step(capD, 0.01) * step(n.y, -0.3)));
      col += GLOW * fre * 0.4;
    } else if (h.y < 2.5) {
      vec3 q = snailLocal(p);
      vec3 s = q - vec3(0.0, 0.34, -0.12);
      if (length(s) < 0.33 && abs(q.x) < 0.21) {
        float spiral = sin(atan(s.y, s.z) * 1.0 + length(s.yz) * 40.0);
        col = mix(vec3(0.45, 0.2, 0.1), vec3(0.95, 0.6, 0.3), step(0.0, spiral)) * (lightCol + 0.1);
        col += vec3(1.0, 0.3, 0.8) * smoothstep(0.8, 1.0, spiral) * 0.5;
      } else {
        col = vec3(0.85, 0.7, 0.55) * (lightCol + 0.12) + vec3(1.0, 0.8, 0.7) * fre * 0.4;
      }
    } else if (h.y < 3.5) {
      vec3 q = toadLocal(p);
      vec3 e = vec3(abs(q.x), q.y, q.z);
      bool eye = length(e - vec3(0.2, 0.6, 0.45)) < 0.105 && q.z > 0.5;
      vec3 skin = mix(vec3(0.25, 0.45, 0.12), vec3(0.6, 0.7, 0.2), noise(q.xz * 8.0));
      skin = mix(skin, vec3(0.1, 0.2, 0.05), step(0.72, noise(q.xz * 13.0 + q.y * 7.0)));
      skin = mix(skin, vec3(0.85, 0.8, 0.55), smoothstep(0.1, -0.2, n.y));
      col = eye ? vec3(1.0, 0.75, 0.1) * 0.9 : skin * (lightCol + 0.1) * ao;
      col += GLOW * fre * 0.25;
    } else {
      col = vec3(1.0, 0.95, 0.45) * 1.6;
    }
    col = mix(col, fogCol, 1.0 - exp(-h.x * 0.06));
  }
  // Firefly haloes and drifting spores.
  for (int i = ZERO; i < 8; i++) {
    vec3 f = fireflyPos(float(i)) - ro;
    float along = dot(f, rd);
    if (along > 0.0) {
      float d = length(f - rd * along);
      col += vec3(1.0, 0.9, 0.4) * 0.012 / (d * d + 0.0015) * 0.02 * (0.6 + 0.4 * sin(T * 4.0 + float(i)));
    }
  }
  col += GLOW * sparkles(uv * vec2(aspect, 1.0), 22.0, 0.05, vec2(T * 0.02, T * 0.03)) * 0.4;
  return vec4(col, h.x < 40.0 ? h.y : 0.0);
}
`,
);
