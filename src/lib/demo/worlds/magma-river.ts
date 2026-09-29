import { defineScene } from "./common";

/** A lava river through black basalt under an erupting volcano: a molten core
 * rising from the flow (1), floating clusters of basalt columns (2) and a
 * polished obsidian arch across the river (3). */
export const MAGMA_RIVER = defineScene(
	"magma-river",
	/* glsl */ `
vec3 CAM;

float riverX(float z) {
  return 2.2 * sin(z * 0.08) + 0.8 * sin(z * 0.21 + 2.0);
}

float terrain(vec3 p) {
  float x = abs(p.x - riverX(p.z));
  float banks = smoothstep(1.8, 6.0, x) * 3.2;
  float h = banks - 0.9 + (fbm3(p.xz * 0.35) - 0.5) * 2.2 * smoothstep(1.0, 4.0, x) + noise(p.xz * 2.5) * 0.15;
  // The volcano, far down the valley.
  vec2 v = p.xz - vec2(riverX(CAM.z + 70.0) + 12.0, CAM.z + 70.0);
  float cone = 26.0 - length(v) * 0.9;
  float crater = 23.5 + 2.5 * smoothstep(2.0, 5.0, length(v));
  h = max(h, min(cone, crater));
  return (p.y - h) * 0.6;
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.103, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Distance to the nearest cell border, for the core's seams.
float voronoiEdge(vec3 x) {
  vec3 ip = floor(x);
  vec3 f = fract(x);
  vec3 mr = vec3(0.0);
  vec3 mg = vec3(0.0);
  float md = 8.0;
  for (int k = ZERO - 1; k <= 1; k++)
  for (int j = ZERO - 1; j <= 1; j++)
  for (int i = ZERO - 1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 r = g + hash33(ip + g) - f;
    float d = dot(r, r);
    if (d < md) {
      md = d;
      mr = r;
      mg = g;
    }
  }
  md = 8.0;
  for (int k = ZERO - 1; k <= 1; k++)
  for (int j = ZERO - 1; j <= 1; j++)
  for (int i = ZERO - 1; i <= 1; i++) {
    vec3 g = mg + vec3(float(i), float(j), float(k));
    vec3 r = g + hash33(ip + g) - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}

const float CORE_R = 2.1;

vec3 coreCentre() {
  float z = CAM.z + 15.0;
  return vec3(riverX(z), 0.5 + 0.25 * sin(T * 0.5), z);
}

vec3 coreLocal(vec3 p) {
  vec3 q = p - coreCentre();
  q.xz *= rot(T * 0.18);
  q.xy *= rot(0.35);
  return q;
}

float core(vec3 p) {
  vec3 q = coreLocal(p);
  return length(q) - CORE_R + (noise3(q * 1.4) - 0.5) * 0.18;
}

// Seven hexagonal columns packed round a centre, each its own length.
float columns(vec3 q, float seed) {
  float d = 1e5;
  for (int i = ZERO; i < 7; i++) {
    float fi = float(i);
    float a = fi * PI / 3.0;
    vec2 at = i == 0 ? vec2(0.0) : vec2(cos(a), sin(a)) * 0.47;
    float h = 0.55 + 0.6 * hash11(fi + seed);
    float top = 0.25 * hash11(fi * 3.7 + seed);
    vec3 c = q - vec3(at.x, top - h, at.y);
    d = min(d, sdHexPrism(c.xzy, vec2(0.235, h)) - 0.01);
  }
  return d;
}

vec3 clusterLocal(vec3 p, float side) {
  float z = CAM.z + (side > 0.0 ? 9.0 : 12.0);
  vec3 q = p - vec3(riverX(z) + side * 3.6, (side > 0.0 ? 3.3 : 3.8) + 0.3 * sin(T * 0.6 + side), z);
  q.xz *= rot(T * 0.15 * side);
  q.xy *= rot(0.3 * side);
  q.yz *= rot(-0.25);
  return q;
}

float basalt(vec3 p) {
  return min(columns(clusterLocal(p, 1.0), 1.0), columns(clusterLocal(p, -1.0), 9.0));
}

vec3 archLocal(vec3 p) {
  float z = CAM.z + 24.0;
  return p - vec3(riverX(z), -0.4, z);
}

float arch(vec3 p) {
  vec3 q = archLocal(p);
  vec2 w = vec2(length(q.xy) - 5.2, q.z);
  vec2 b = abs(w) - vec2(0.42, 0.6);
  // Faceted edges: a bevelled square section rather than a rounded one.
  b = max(b, (abs(w.x) + abs(w.y) - 0.85) * 0.7071 * vec2(1.0));
  return length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - 0.03;
}

vec2 map(vec3 p) {
  vec2 res = vec2(min(terrain(p), p.y + 0.02), 0.0);
  if (withElements()) {
    res = nearest(res, vec2(core(p), 1.0));
    res = nearest(res, vec2(basalt(p), 2.0));
    res = nearest(res, vec2(arch(p), 3.0));
  }
  return res;
}

vec3 lava(vec3 p) {
  vec2 flow = p.xz * 0.9 + vec2(0.0, -T * 0.35);
  float heat = fbm(flow + fbm(flow * 0.7 + T * 0.1) * 1.5);
  float crust = smoothstep(0.52, 0.62, fbm(p.xz * 1.6 - vec2(0.0, T * 0.3)));
  vec3 hot = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.3), smoothstep(0.4, 0.8, heat));
  return mix(hot * 2.2, vec3(0.08, 0.03, 0.02), crust * 0.85);
}

vec3 sky(vec3 rd) {
  vec3 col = mix(vec3(0.55, 0.14, 0.05), vec3(0.08, 0.02, 0.03), smoothstep(-0.05, 0.5, rd.y));
  float smoke = fbm(rd.xy / (rd.z + 1.2) * 3.0 + vec2(T * 0.03, 0.0));
  col = mix(col, vec3(0.12, 0.06, 0.06), smoothstep(0.35, 0.75, smoke) * 0.8);
  // The eruption's glow above the crater.
  vec3 v = normalize(vec3(riverX(CAM.z + 70.0) + 12.0, 28.0, CAM.z + 70.0) - CAM);
  col += vec3(1.0, 0.35, 0.05) * pow(max(dot(rd, v), 0.0), 20.0) * 1.2;
  return col;
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  float z = T * 1.1;
  CAM = vec3(riverX(z) - 0.5, 2.3 + 0.2 * sin(T * 0.3), z);
  vec3 ta = vec3(riverX(z + 7.0), 1.2, z + 7.0);
  vec3 rd = cameraRay(uv, aspect, CAM, ta, 1.45, 0.04 * sin(T * 0.2));
  vec2 h = march(CAM, rd, 110.0, 0.8);
  vec3 bg = sky(rd);
  vec3 col = bg;
  if (h.x < 110.0) {
    vec3 p = CAM + rd * h.x;
    vec3 n = calcNormal(p);
    // Everything is lit from below by the lava.
    float nearLava = exp(-max(p.y + 0.02, 0.0) * 1.3);
    vec3 under = vec3(1.0, 0.35, 0.08) * nearLava * (0.6 + 0.4 * max(-n.y + 0.3, 0.0));
    vec3 key = normalize(vec3(0.3, 0.6, 0.7));
    vec3 lit = vec3(0.35, 0.2, 0.18) * max(dot(n, key), 0.0) + under * 1.2 + vec3(0.06, 0.04, 0.05);
    float fre = fresnel(n, rd, 3.0);
    if (h.y < 0.5) {
      if (p.y < 0.0 && terrain(p) > 0.0) {
        col = lava(p);
      } else {
        vec3 basalt = mix(vec3(0.07, 0.06, 0.06), vec3(0.16, 0.13, 0.12), noise3(p * 2.0));
        col = basalt * lit * 2.0 * calcAO(p, n);
        // Glowing seams in the rock.
        col += vec3(1.0, 0.3, 0.05) * smoothstep(0.03, 0.0, abs(noise(p.xz * 1.4) - 0.5)) * nearLava * 0.6;
        // The volcano's lava streaks.
        if (p.y > 8.0) col += vec3(1.0, 0.3, 0.05) * smoothstep(0.08, 0.0, abs(sin(atan(p.x - riverX(CAM.z + 70.0) - 12.0, p.z - CAM.z - 70.0) * 7.0 + p.y * 0.1))) * smoothstep(8.0, 24.0, p.y) * 1.5;
      }
    } else if (h.y < 1.5) {
      // Cooled plates of crust, split by seams of magma that run hotter lower down.
      vec3 q = coreLocal(p);
      float e = voronoiEdge(q * 1.25);
      float heat = smoothstep(1.4, -1.6, p.y - coreCentre().y) * 0.6 + 0.4;
      float seam = smoothstep(0.1 * heat + 0.02, 0.0, e);
      float plate = noise3(q * 3.0);
      vec3 crust = mix(vec3(0.05, 0.04, 0.04), vec3(0.16, 0.12, 0.1), plate) * lit * 2.2;
      crust += vec3(0.9, 0.3, 0.05) * smoothstep(0.25, 0.0, e) * heat * 0.35;
      vec3 magma = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.9, 0.45), seam * heat) * (1.6 + 0.4 * sin(T * 2.0 + plate * 6.0));
      col = mix(crust, magma, seam);
      col += vec3(1.0, 0.45, 0.1) * fre * 0.35;
    } else if (h.y < 2.5) {
      // Basalt columns: dark flat tops, molten drips glowing underneath.
      vec3 r = reflect(rd, n);
      vec3 stone = mix(vec3(0.06, 0.055, 0.06), vec3(0.15, 0.12, 0.11), noise3(p * 5.0));
      col = stone * (lit * 1.6 + 0.2) + sky(r) * 0.25 * fre;
      // Molten undersides, dripping down the faces in thin runs.
      float below = smoothstep(0.3, -0.8, n.y);
      float runs = smoothstep(0.06, 0.0, abs(noise(vec2(atan(n.z, n.x) * 6.0, p.y * 0.8)) - 0.5)) * smoothstep(0.7, 0.0, abs(n.y));
      vec3 hot = vec3(1.0, 0.4, 0.06) * (1.3 + 0.3 * sin(T * 2.0 + p.y * 3.0));
      col += hot * (below * 1.2 + runs * 0.8);
      col += vec3(1.0, 0.6, 0.3) * pow(fre, 4.0) * 0.8;
    } else {
      // Polished obsidian mirroring the fire, a glowing inlay down its face.
      vec3 q = archLocal(p);
      vec3 r = reflect(rd, n);
      col = vec3(0.015, 0.01, 0.02) + sky(r) * (0.25 + 0.75 * fre) + under * 0.25;
      col += pow(max(dot(r, normalize(vec3(0.3, 0.6, 0.7))), 0.0), 40.0) * 0.8;
      float inlay = smoothstep(0.05, 0.0, abs(q.z + 0.6)) * smoothstep(0.05, 0.0, abs(length(q.xy) - 5.2));
      col += vec3(1.0, 0.55, 0.15) * inlay * 5.0;
      col += vec3(1.0, 0.35, 0.08) * smoothstep(0.3, 0.0, abs(q.z + 0.6)) * smoothstep(0.3, 0.0, abs(length(q.xy) - 5.2)) * 0.6;
    }
    col = mix(col, bg, 1.0 - exp(-h.x * 0.022));
  }
  // Embers rising.
  col += vec3(1.0, 0.55, 0.15) * sparkles(uv * vec2(aspect, 1.0), 26.0, 0.06, vec2(T * 0.02, -T * 0.25)) * 0.9;
  col += vec3(1.0, 0.4, 0.1) * sparkles(uv * vec2(aspect, 1.0) + 3.0, 16.0, 0.05, vec2(-T * 0.03, -T * 0.18)) * 0.6;
  return vec4(col, h.x < 110.0 ? h.y : 0.0);
}
`,
);
