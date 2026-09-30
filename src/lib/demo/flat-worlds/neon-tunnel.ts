import { defineFlatScene } from "./common";

/** Falling down a checkered neon tunnel toward a spinning star (1), a dashed ring
 * (2) pulsing around it. */
export const NEON_TUNNEL = defineFlatScene(
	"neon-tunnel",
	/* glsl */ `
vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  vec2 p = centred(uv, aspect);
  p += vec2(sin(T * 0.4), cos(T * 0.3)) * 0.04;
  float r = length(p);
  float a = atan(p.y, p.x);
  vec2 tv = vec2(a / TAU * 12.0 + T * 0.15, 0.22 / max(r, 1e-3) + T * 1.4);
  float check = mod(floor(tv.x) + floor(tv.y), 2.0);
  vec3 hue = 0.5 + 0.5 * cos(TAU * (floor(tv.y) * 0.13 + vec3(0.0, 0.33, 0.67)));
  vec3 col = mix(vec3(0.03, 0.0, 0.07), hue, check) * smoothstep(0.02, 0.45, r);
  float id = 0.0;
  if (withElements()) {
    vec2 q = rot(T * 1.2) * p;
    float pulse = 0.5 + 0.5 * sin(T * 3.0);
    if (sdStar5(q, 0.1 + 0.02 * pulse, 0.45) < 0.0) {
      col = mix(vec3(1.0, 0.95, 0.4), vec3(1.0, 0.4, 0.8), smoothstep(0.0, 0.1, length(q)));
      id = 1.0;
    }
    float ringR = 0.2 + 0.05 * pulse;
    float dash = step(0.35, fract(a / TAU * 16.0 - T * 0.5));
    if (abs(r - ringR) < 0.012 && dash > 0.5) {
      col = vec3(0.3, 1.0, 0.9);
      id = 2.0;
    }
  }
  return vec4(col, id);
}
`,
);
