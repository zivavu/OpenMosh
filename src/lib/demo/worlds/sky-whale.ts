import { defineScene } from "./common";

/** Golden hour above a sea of clouds: a humpback whale gliding alongside (1), a
 * flock of birds (2) and a striped hot-air balloon (3). */
export const SKY_WHALE = defineScene(
	"sky-whale",
	/* glsl */ `
vec3 CAM;
const vec3 SUN_DIR = vec3(0.28, 0.12, 0.95);

float clouds(vec3 p) {
  vec2 q = p.xz * 0.21 + vec2(T * 0.03, 0.0);
  float h = -2.6 + fbm3(q) * 3.4 + noise(q * 4.0) * 0.3;
  return (p.y - h) * 0.6;
}

float tailSwing(float z) {
  return sin(z * 0.7 - T * 1.4) * 0.22 * smoothstep(0.5, -3.5, z);
}

vec3 whaleLocal(vec3 p) {
  vec3 q = p - CAM - vec3(2.2, 0.2 + 0.3 * sin(T * 0.35), 9.5);
  q.xz *= rot(-1.05);
  q.yz *= rot(0.08 * sin(T * 0.35 + 1.0));
  q.y -= tailSwing(q.z);
  return q;
}

float whale(vec3 p) {
  vec3 q = whaleLocal(p);
  float body = sdEllipsoid(q - vec3(0.0, 0.0, 0.3), vec3(0.95, 0.85, 2.7));
  float tail = sdTaper(q, vec3(0.0, 0.0, -1.8), vec3(0.0, 0.1, -4.2), 0.6, 0.1);
  float d = smin(body, tail, 0.5);
  vec3 f = q - vec3(0.0, 0.1, -4.35);
  f.x = abs(f.x);
  f.xz *= rot(0.45);
  d = smin(d, sdEllipsoid(f - vec3(0.55, 0.0, 0.0), vec3(0.75, 0.05, 0.28)), 0.12);
  vec3 fin = q - vec3(0.0, -0.4, 1.0);
  fin.x = abs(fin.x);
  fin.xy *= rot(0.5 + 0.18 * sin(T * 0.9));
  fin.xz *= rot(-0.5);
  d = smin(d, sdEllipsoid(fin - vec3(1.2, 0.0, 0.0), vec3(1.15, 0.06, 0.32)), 0.15);
  // Dorsal hump.
  d = smin(d, sdEllipsoid(q - vec3(0.0, 0.72, -1.4), vec3(0.08, 0.22, 0.35)), 0.2);
  return d;
}

vec3 birdCentre(float i) {
  return CAM + vec3(-2.6 + sin(i * 2.3) * 1.4, 2.2 + cos(i * 1.7) * 0.7 + 0.2 * sin(T + i), 12.0 + i * 0.9);
}

float birds(vec3 p) {
  float d = 1e5;
  for (int i = ZERO; i < 6; i++) {
    float fi = float(i);
    vec3 q = p - birdCentre(fi);
    float flap = sin(T * 7.0 + fi * 1.9) * 0.6;
    vec3 w = vec3(abs(q.x), q.y, q.z);
    w.xy *= rot(-flap);
    float wing = sdEllipsoid(w - vec3(0.22, 0.0, 0.0), vec3(0.24, 0.015, 0.07));
    float body = sdEllipsoid(q, vec3(0.05, 0.05, 0.14));
    d = min(d, min(wing, body));
  }
  return d;
}

vec3 balloonLocal(vec3 p) {
  return p - CAM - vec3(-5.0, 3.0 + 0.4 * sin(T * 0.4), 24.0);
}

float balloon(vec3 p) {
  vec3 q = balloonLocal(p);
  float env = sdEllipsoid(q - vec3(0.0, 0.25, 0.0), vec3(1.2, 1.4, 1.2));
  env = smin(env, sdCappedCone(q - vec3(0.0, -0.9, 0.0), 0.55, 0.3, 0.95), 0.25);
  float basket = sdRoundBox(q - vec3(0.0, -2.2, 0.0), vec3(0.3, 0.22, 0.3), 0.05);
  vec3 r = vec3(abs(q.x), q.y, abs(q.z));
  float ropes = sdCapsule(r, vec3(0.28, -2.0, 0.28), vec3(0.3, -1.4, 0.3), 0.012);
  return min(env, min(basket, ropes));
}

vec2 map(vec3 p) {
  vec2 res = vec2(clouds(p), 0.0);
  if (withElements()) {
    res = nearest(res, vec2(whale(p), 1.0));
    res = nearest(res, vec2(birds(p), 2.0));
    res = nearest(res, vec2(balloon(p), 3.0));
  }
  return res;
}

vec3 sky(vec3 rd) {
  vec3 s = normalize(SUN_DIR);
  vec3 col = mix(vec3(1.0, 0.62, 0.38), vec3(0.22, 0.38, 0.72), smoothstep(-0.05, 0.5, rd.y));
  col = mix(col, vec3(0.08, 0.14, 0.35), smoothstep(0.5, 1.0, rd.y));
  float sd = max(dot(rd, s), 0.0);
  col += vec3(1.0, 0.75, 0.45) * pow(sd, 8.0) * 0.5 + vec3(1.0, 0.9, 0.7) * pow(sd, 250.0) * 3.0;
  // High streaks of cirrus.
  vec2 c = rd.xz / max(rd.y + 0.2, 0.05);
  col += vec3(1.0, 0.8, 0.7) * smoothstep(0.55, 0.85, fbm(c * vec2(0.4, 1.6) + T * 0.01)) * 0.25 * smoothstep(0.0, 0.3, rd.y);
  return col;
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  CAM = vec3(0.0, 1.3 + 0.2 * sin(T * 0.25), T * 1.6);
  vec3 ta = CAM + vec3(0.6, 0.1, 6.0);
  vec3 rd = cameraRay(uv, aspect, CAM, ta, 1.35, 0.05 * sin(T * 0.2));
  vec2 h = march(CAM, rd, 90.0, 0.8);
  vec3 s = normalize(SUN_DIR);
  vec3 bg = sky(rd);
  vec3 col = bg;
  if (h.x < 90.0) {
    vec3 p = CAM + rd * h.x;
    vec3 n = calcNormal(p);
    float dif = max(dot(n, s), 0.0);
    float fre = fresnel(n, rd, 3.0);
    vec3 warm = vec3(1.0, 0.75, 0.5);
    vec3 amb = mix(vec3(0.45, 0.4, 0.65), vec3(0.6, 0.7, 0.95), 0.5 + 0.5 * n.y);
    if (h.y < 0.5) {
      // Soft, backlit cloud tops.
      float depth = clamp((p.y + 2.0) / 2.6, 0.0, 1.0);
      vec3 base = mix(vec3(0.75, 0.6, 0.8), vec3(1.0, 0.93, 0.88), depth);
      col = base * (amb * 0.55 + warm * (0.35 + 0.65 * dif));
      col += warm * pow(max(dot(rd, s), 0.0), 6.0) * 0.35;
      col = mix(col, bg, 1.0 - exp(-h.x * 0.011));
    } else if (h.y < 1.5) {
      vec3 q = whaleLocal(p);
      float belly = smoothstep(0.15, -0.35, q.y);
      float grooves = belly * step(0.5, fract(q.x * 9.0)) * step(-0.5, q.z) * 0.25;
      vec3 base = mix(vec3(0.16, 0.22, 0.32), vec3(0.82, 0.8, 0.76), belly) - grooves;
      base = mix(base, vec3(0.9), step(0.93, noise(q.xz * 14.0)) * step(0.8, q.z) * (1.0 - belly));
      float eye = smoothstep(0.08, 0.06, length(vec3(abs(q.x), q.y, q.z) - vec3(0.72, -0.12, 1.75)));
      base = mix(base, vec3(0.02), eye);
      col = base * (amb * 0.7 + warm * dif * 0.9) + warm * fre * 0.35;
    } else if (h.y < 2.5) {
      col = vec3(0.12, 0.1, 0.12) * (amb * 0.6 + warm * dif) + warm * fre * 0.3;
    } else {
      vec3 q = balloonLocal(p);
      vec3 base;
      if (q.y < -1.8) base = vec3(0.55, 0.35, 0.18);
      else {
        float band = floor(mod((atan(q.z, q.x) / TAU + 0.5) * 12.0, 4.0));
        base = band < 1.0 ? vec3(1.0, 0.3, 0.35) : band < 2.0 ? vec3(1.0, 0.85, 0.3) : band < 3.0 ? vec3(0.25, 0.7, 0.85) : vec3(0.98, 0.95, 0.9);
      }
      col = base * (amb * 0.5 + warm * (0.2 + 0.8 * dif)) + warm * fre * 0.3;
    }
    if (h.y > 0.5) col = mix(col, bg, 1.0 - exp(-h.x * 0.012));
  }
  return vec4(aces(col * 1.1), h.x < 90.0 ? h.y : 0.0);
}
`,
);
