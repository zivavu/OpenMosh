import { defineFlatScene } from "./common";

/** A synthwave drive: grid floor rushing in under purple hills, a striped sun (1)
 * sinking behind them and a spinning neon triangle (2) up in the sky. */
export const SUNSET_DRIVE = defineFlatScene(
	"sunset-drive",
	/* glsl */ `
const float HORIZON = -0.08;

float hills(float x) {
  return HORIZON + 0.05 + 0.09 * noise(vec2(x * 3.0 + T * 0.08, 0.0))
    + 0.03 * noise(vec2(x * 11.0 + T * 0.16, 4.0));
}

vec3 sky(vec2 p) {
  vec3 col = mix(vec3(1.0, 0.45, 0.25), vec3(0.6, 0.08, 0.45), smoothstep(-0.05, 0.18, p.y));
  col = mix(col, vec3(0.07, 0.02, 0.18), smoothstep(0.12, 0.5, p.y));
  return col + stars(p, 38.0, 0.08) * smoothstep(0.1, 0.35, p.y);
}

vec3 ground(vec2 p) {
  float depth = HORIZON - p.y;
  float z = 0.12 / depth;
  vec2 g = vec2(p.x * z * 2.0, z + T * 1.6);
  float lines = gridLines(g, 0.03);
  vec3 col = mix(vec3(0.04, 0.0, 0.08), vec3(1.0, 0.2, 0.85), lines * smoothstep(0.0, 0.03, depth));
  return col + vec3(1.0, 0.35, 0.5) * exp(-depth * 18.0) * 0.6;
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  vec2 p = centred(uv, aspect);
  float ridge = hills(p.x);
  vec3 col = p.y < HORIZON ? ground(p)
    : p.y < ridge ? mix(vec3(0.16, 0.03, 0.26), vec3(0.95, 0.3, 0.6), smoothstep(ridge - 0.02, ridge, p.y) * 0.8)
    : sky(p);
  float id = 0.0;
  if (withElements()) {
    vec2 sun = p - vec2(0.0, HORIZON + 0.14 + 0.03 * sin(T * 0.3));
    bool gap = fract(sun.y * 22.0 + T * 0.6) < mix(0.0, 0.55, smoothstep(0.02, -0.18, sun.y));
    if (length(sun) < 0.24 && p.y > ridge && !gap) {
      col = mix(vec3(1.0, 0.2, 0.55), vec3(1.0, 0.9, 0.3), smoothstep(-0.2, 0.2, sun.y));
      id = 1.0;
    }
    vec2 q = p - vec2(-0.42 * aspect * 0.5 + 0.05 * sin(T * 0.7), 0.26 + 0.03 * sin(T * 1.1));
    q *= rot(T * 0.9);
    float tri = abs(sdTriangle(q, 0.08)) - 0.009;
    if (tri < 0.0) {
      col = mix(vec3(0.2, 1.0, 1.0), vec3(1.0), 0.5 + 0.5 * sin(T * 4.0 + q.x * 30.0));
      id = 2.0;
    }
  }
  return vec4(col, id);
}
`,
);
