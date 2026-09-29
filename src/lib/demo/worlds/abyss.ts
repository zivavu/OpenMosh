import { defineScene } from "./common";

/** Drifting through a kelp forest in deep water, light shafts from far above,
 * three glowing jellyfish (1-3) pulsing along. */
export const ABYSS = defineScene(
	"abyss",
	/* glsl */ `
vec3 CAM;
const float FLOOR_Y = -5.0;

float kelp(vec3 p) {
  vec2 cell = floor(p.xz / 3.2);
  vec3 q = p;
  q.xz = mod(p.xz, 3.2) - 1.6;
  vec2 jitter = hash22(cell) - 0.5;
  q.xz -= jitter * 1.6;
  // Keep a clear lane down the middle for the camera.
  float lane = abs(p.x - CAM.x) < 2.6 ? 1.0 : 0.0;
  float sway = sin(p.y * 0.55 + T * 0.9 + hash21(cell) * 6.0) * 0.35 * (p.y - FLOOR_Y) * 0.12;
  q.x -= sway;
  float h = 5.0 + hash21(cell + 3.1) * 5.0;
  float blade = sdBox(q - vec3(0.0, FLOOR_Y + h * 0.5, 0.0), vec3(0.09, h * 0.5, 0.02 + 0.03 * sin(p.y * 3.0)));
  return lane > 0.5 ? 1e5 : blade * 0.6;
}

float seabed(vec3 p) {
  float h = fbm3(p.xz * 0.25) * 1.6 + noise(p.xz * 1.3) * 0.2;
  return (p.y - FLOOR_Y - h) * 0.8;
}

vec3 jellyPos(float i) {
  vec3 o = vec3(
    i == 1.0 ? 0.9 : i == 2.0 ? -1.9 : 2.8,
    i == 1.0 ? 0.2 : i == 2.0 ? 1.1 : 1.9,
    i == 1.0 ? 5.5 : i == 2.0 ? 8.5 : 12.0);
  o.y += sin(T * 0.4 + i * 2.0) * 0.4;
  o.x += sin(T * 0.23 + i) * 0.3;
  return CAM + o;
}

float jelly(vec3 p, float i) {
  vec3 q = p - jellyPos(i);
  q.xy *= rot(sin(T * 0.3 + i) * 0.25);
  float beat = 0.5 + 0.5 * sin(T * 2.2 + i * 1.7);
  float r = 0.62 + 0.08 * beat;
  float bell = sdEllipsoid(q, vec3(r, r * (0.72 - 0.12 * beat), r));
  bell = max(abs(bell) - 0.035, -q.y - 0.02);
  // Frilled rim.
  float rim = abs(q.y + 0.02 + 0.03 * sin(atan(q.z, q.x) * 16.0));
  bell = min(bell, max(abs(length(q.xz) - r * 0.97) - 0.04, rim - 0.03));
  // Tentacles around the rim, rippling as they trail.
  float sector = TAU / 9.0;
  float a = atan(q.z, q.x);
  float k = floor((a + sector * 0.5) / sector);
  float ca = k * sector;
  vec2 dir = vec2(cos(ca), sin(ca));
  float len = 2.2 + hash11(k + i * 13.0) * 1.2;
  float y = clamp(-q.y, 0.0, len);
  vec2 wave = vec2(sin(y * 2.4 - T * 2.6 + k), cos(y * 1.9 - T * 2.1 + k)) * 0.12 * (y / len + 0.2);
  vec3 c = vec3(dir.x * r * 0.75 + wave.x, -y, dir.y * r * 0.75 + wave.y);
  float tent = (length(q - c) - 0.022 * (1.0 - 0.7 * y / len)) * 0.7;
  // Oral arms, a twisting ribbon in the middle.
  float ay = clamp(-q.y, 0.0, 1.5);
  vec3 ac = vec3(sin(ay * 3.0 + T) * 0.1, -ay, cos(ay * 3.0 + T) * 0.1);
  float arms = (length(q - ac) - 0.09 * (1.0 - ay / 1.8)) * 0.7;
  return min(min(bell, tent), arms);
}

vec2 map(vec3 p) {
  vec2 res = vec2(min(seabed(p), kelp(p)), 0.0);
  if (withElements()) {
    for (int i = ZERO + 1; i <= 3; i++) {
      float fi = float(i);
      res = nearest(res, vec2(jelly(p, fi), fi));
    }
  }
  return res;
}

vec3 water(vec3 rd) {
  vec3 deep = vec3(0.0, 0.02, 0.06);
  vec3 shallow = vec3(0.02, 0.28, 0.42);
  vec3 col = mix(deep, shallow, smoothstep(-0.4, 0.9, rd.y));
  // Shafts of light from the surface.
  float a = atan(rd.x, rd.z);
  float shafts = pow(0.5 + 0.5 * sin(a * 9.0 + sin(a * 3.0 + T * 0.2) * 2.0), 6.0)
    + pow(0.5 + 0.5 * sin(a * 23.0 - T * 0.15), 12.0) * 0.5;
  col += vec3(0.25, 0.65, 0.7) * shafts * smoothstep(0.0, 0.9, rd.y) * 0.35;
  col += vec3(0.5, 0.9, 1.0) * pow(max(rd.y, 0.0), 12.0) * 0.6;
  return col;
}

vec3 jellyColor(float i) {
  return i == 1.0 ? vec3(1.0, 0.35, 0.8) : i == 2.0 ? vec3(0.3, 0.9, 1.0) : vec3(0.7, 0.5, 1.0);
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  CAM = vec3(sin(T * 0.1) * 0.8, -1.2 + sin(T * 0.13) * 0.4, T * 0.7);
  vec3 ta = CAM + vec3(sin(T * 0.07) * 0.8, 0.9, 6.0);
  vec3 rd = cameraRay(uv, aspect, CAM, ta, 1.5, sin(T * 0.1) * 0.04);
  vec2 h = march(CAM, rd, 45.0, 0.8);
  vec3 bg = water(rd);
  vec3 col = bg;
  if (h.x < 45.0) {
    vec3 p = CAM + rd * h.x;
    vec3 n = calcNormal(p);
    float fre = fresnel(n, rd, 2.5);
    if (h.y > 0.5) {
      vec3 jc = jellyColor(h.y);
      vec3 q = p - jellyPos(h.y);
      float inner = smoothstep(0.1, -0.8, q.y);
      col = jc * (0.25 + 1.4 * fre) + jc * 0.5 * inner + vec3(1.0) * pow(fre, 4.0) * 0.6;
      // Glowing spots on the bell.
      col += jc * smoothstep(0.35, 0.0, abs(sin(atan(q.z, q.x) * 8.0) * sin(q.y * 12.0))) * 0.25 * step(-0.05, q.y);
    } else {
      float caustic = pow(abs(sin(p.x * 2.1 + T * 0.8) * sin(p.z * 1.7 - T * 0.6) + sin((p.x + p.z) * 1.3 + T)), 3.0);
      bool isKelp = kelp(p) < seabed(p);
      vec3 base = isKelp
        ? mix(vec3(0.08, 0.35, 0.18), vec3(0.45, 0.6, 0.15), noise(p.xy * 4.0))
        : mix(vec3(0.16, 0.18, 0.2), vec3(0.32, 0.3, 0.24), noise(p.xz * 2.0));
      float lit = 0.25 + 0.75 * max(n.y, 0.0);
      col = base * lit * (0.6 + 0.9 * caustic * max(n.y, 0.0)) * calcAO(p, n);
      col += vec3(0.1, 0.6, 0.7) * fre * 0.2;
    }
    col = mix(col, bg * 0.9, 1.0 - exp(-h.x * 0.075));
  }
  // Marine snow, drifting up.
  col += vec3(0.7, 0.9, 1.0) * sparkles(uv * vec2(aspect, 1.0), 26.0, 0.07, vec2(0.0, -T * 0.08)) * 0.5;
  col += vec3(0.7, 0.9, 1.0) * sparkles(uv * vec2(aspect, 1.0), 14.0, 0.05, vec2(T * 0.02, -T * 0.05)) * 0.35;
  return vec4(col, h.x < 45.0 ? h.y : 0.0);
}
`,
);
