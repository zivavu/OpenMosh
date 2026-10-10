import { defineScene } from "./common";

/** A mirrored checkerboard plaza under a pastel sky: a dolphin leaping through
 * (1) a chrome ring (2) and a spinning CD (3). */
export const VAPOR_PLAZA = defineScene(
	"vapor-plaza",
	/* glsl */ `
vec3 CAM;
const vec3 SUN_DIR = vec3(0.0, 0.18, 1.0);

float colonnade(vec3 p) {
  vec3 q = p;
  q.x = abs(q.x) - 4.4;
  float z = mod(q.z, 3.6) - 1.8;
  vec3 c = vec3(q.x, q.y, z);
  float r = 0.34 + 0.018 * sin(atan(c.z, c.x) * 16.0);
  float shaft = sdCylinder(c - vec3(0.0, 1.7, 0.0), 1.7, r);
  float base = sdBox(c - vec3(0.0, 0.1, 0.0), vec3(0.5, 0.1, 0.5));
  float capital = sdBox(c - vec3(0.0, 3.45, 0.0), vec3(0.52, 0.1, 0.52));
  float beam = sdBox(q - vec3(0.0, 3.8, 0.0), vec3(0.55, 0.25, 1e4));
  return min(min(shaft, beam), min(base, capital));
}

vec3 ringCentre() {
  return CAM + vec3(0.0, 2.4, 10.0);
}

// Where the leap is, 0-1, and the dolphin's centre and heading. Both ends sit
// deep enough under the floor to hide it whole, so the wrap never shows.
vec3 dolphinPos(out float heading) {
  float s = fract(T * 0.16);
  float x = mix(-5.0, 5.0, s);
  float y = -3.2 + 5.6 * sin(PI * s);
  float dy = 5.6 * PI * cos(PI * s) / 10.0;
  heading = atan(dy, 1.0);
  return ringCentre() + vec3(x, y - 2.4, 0.0);
}

vec3 dolphinLocal(vec3 p) {
  float heading;
  vec3 q = p - dolphinPos(heading);
  q.xy *= rot(-heading);
  q.y -= sin(q.x * 1.6 + T * 5.0) * 0.05 * smoothstep(0.0, -1.2, q.x);
  return q;
}

float dolphin(vec3 p) {
  vec3 q = dolphinLocal(p);
  float body = sdEllipsoid(q - vec3(0.1, 0.0, 0.0), vec3(0.95, 0.36, 0.34));
  body = smin(body, sdEllipsoid(q - vec3(0.72, 0.04, 0.0), vec3(0.3, 0.26, 0.25)), 0.15);
  float tail = sdTaper(q, vec3(-0.6, 0.0, 0.0), vec3(-1.55, 0.05, 0.0), 0.2, 0.05);
  float d = smin(body, tail, 0.2);
  d = smin(d, sdCapsule(q, vec3(0.8, -0.05, 0.0), vec3(1.3, -0.08, 0.0), 0.07), 0.1);
  vec3 f = vec3(q.x, q.y, abs(q.z));
  d = smin(d, sdEllipsoid(f - vec3(-1.62, 0.05, 0.22), vec3(0.14, 0.03, 0.28)), 0.05);
  d = smin(d, sdEllipsoid(q - vec3(-0.1, 0.33, 0.0), vec3(0.2, 0.22, 0.04)), 0.08);
  d = smin(d, sdEllipsoid(f - vec3(0.3, -0.22, 0.28), vec3(0.2, 0.04, 0.14)), 0.06);
  return d;
}

float ring(vec3 p) {
  vec3 q = p - ringCentre();
  q.xz *= rot(0.25 * sin(T * 0.4));
  return sdTorus(q.xzy, vec2(1.35, 0.1));
}

vec3 discLocal(vec3 p) {
  vec3 q = p - CAM - vec3(-2.9, 2.0 + 0.2 * sin(T * 0.6), 8.0);
  q.yz *= rot(1.1);
  q.xy *= rot(0.3);
  q.xz *= rot(T * 1.2);
  return q;
}

float disc(vec3 p) {
  vec3 q = discLocal(p);
  float d = sdCylinder(q, 0.018, 0.78);
  return max(d, -(length(q.xz) - 0.12));
}

vec2 map(vec3 p) {
  vec2 res = vec2(min(p.y, colonnade(p)), 0.0);
  if (withElements()) {
    res = nearest(res, vec2(dolphin(p), 1.0));
    res = nearest(res, vec2(ring(p), 2.0));
    res = nearest(res, vec2(disc(p), 3.0));
  }
  return res;
}

vec3 sky(vec3 rd) {
  vec3 col = mix(vec3(1.0, 0.62, 0.78), vec3(0.3, 0.82, 0.88), smoothstep(-0.02, 0.55, rd.y));
  vec3 s = normalize(SUN_DIR);
  vec2 sp = rd.xy / max(rd.z, 0.01) - s.xy / s.z;
  float r = length(sp);
  vec3 sun = mix(vec3(1.0, 0.4, 0.65), vec3(1.0, 0.92, 0.5), smoothstep(-0.2, 0.2, sp.y));
  col = mix(col, sun, smoothstep(0.23, 0.22, r) * step(0.0, rd.z));
  col += vec3(1.0, 0.7, 0.8) * exp(-r * 5.0) * 0.3;
  // A wireframe horizon grid far out.
  vec2 g = abs(fract(vec2(atan(rd.x, rd.z) * 12.0, rd.y * 40.0)) - 0.5);
  col += vec3(1.0, 0.4, 0.9) * smoothstep(0.46, 0.5, max(g.x, g.y)) * smoothstep(0.12, 0.0, rd.y) * 0.25;
  return col;
}

vec3 backdrop(vec3 p, vec3 rd, vec3 n) {
  if (p.y < 0.01) {
    vec2 c = floor(p.xz * 0.9);
    float check = mod(c.x + c.y, 2.0);
    float veins = smoothstep(0.02, 0.0, abs(fbm3(p.xz * 1.7) - 0.5)) * 0.25;
    return mix(vec3(1.0, 0.75, 0.84), vec3(0.97, 0.95, 0.96), check) - veins;
  }
  float fl = 0.8 + 0.2 * sin(atan(p.z, p.x) * 16.0);
  return vec3(0.96, 0.9, 0.93) * fl;
}

vec3 light(vec3 base, vec3 p, vec3 n, vec3 rd) {
  vec3 key = normalize(vec3(-0.4, 0.8, -0.3));
  float dif = max(dot(n, key), 0.0);
  vec3 amb = mix(vec3(1.0, 0.7, 0.85), vec3(0.6, 0.9, 0.95), 0.5 + 0.5 * n.y);
  return base * (amb * 0.45 + vec3(1.0, 0.95, 0.9) * dif * 0.7) * calcAO(p, n);
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  CAM = vec3(0.6 * sin(T * 0.1), 1.25, T * 0.9);
  vec3 ta = CAM + vec3(0.0, 0.9, 6.0);
  vec3 rd = cameraRay(uv, aspect, CAM, ta, 1.45, 0.0);
  vec2 h = march(CAM, rd, 70.0, 0.9);
  vec3 bg = sky(rd);
  vec3 col = bg;
  if (h.x < 70.0) {
    vec3 p = CAM + rd * h.x;
    vec3 n = calcNormal(p);
    vec3 r = reflect(rd, n);
    float fre = fresnel(n, rd, 4.0);
    if (h.y < 0.5) {
      col = light(backdrop(p, rd, n), p, n, rd);
      if (p.y < 0.01) {
        // A polished floor: one bounce.
        float rt = 0.05;
        for (int i = ZERO; i < 48; i++) {
          float d = colonnade(p + r * rt);
          if (d < 0.002 * rt || rt > 40.0) break;
          rt += d;
        }
        vec2 rh = vec2(rt, 0.0);
        vec3 refl = sky(r);
        if (rh.x < 40.0) {
          // Flat-lit: a reflection doesn't need its own normal or occlusion.
          vec3 rp = p + n * 0.02 + r * rh.x;
          vec3 rc = backdrop(rp, r, vec3(0.0, 1.0, 0.0)) * vec3(0.85, 0.78, 0.86);
          refl = mix(rc, sky(r), 1.0 - exp(-rh.x * 0.03));
        }
        col = mix(col, refl, 0.35 + 0.4 * fre);
      }
    } else if (h.y < 1.5) {
      vec3 q = dolphinLocal(p);
      vec3 base = mix(vec3(0.95, 0.92, 0.95), vec3(0.4, 0.5, 0.68), smoothstep(-0.12, 0.08, q.y));
      float eye = smoothstep(0.05, 0.035, length(vec3(q.x, q.y, abs(q.z)) - vec3(0.78, 0.08, 0.2)));
      col = light(mix(base, vec3(0.05), eye), p, n, rd) + sky(r) * fre * 0.5;
    } else if (h.y < 2.5) {
      col = sky(r) * vec3(1.0, 0.8, 0.9) + pow(max(dot(r, normalize(SUN_DIR)), 0.0), 30.0);
    } else {
      vec3 q = discLocal(p);
      float a = atan(q.z, q.x);
      vec3 rainbow = 0.5 + 0.5 * cos(TAU * (length(q.xz) * 2.5 + a * 0.3 + vec3(0.0, 0.33, 0.67)));
      col = mix(vec3(0.85), rainbow, 0.6) * (0.6 + 0.4 * abs(n.y)) + sky(r) * 0.3;
    }
    col = mix(col, bg, 1.0 - exp(-h.x * 0.025));
  }
  return vec4(col, h.x < 70.0 ? h.y : 0.0);
}
`,
);
