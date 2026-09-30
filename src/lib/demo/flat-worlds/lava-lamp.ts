import { defineFlatScene } from "./common";

/** Inside a lava lamp: two wax flows, amber (1) and magenta (2), rising and
 * merging in a haze of bubbles. */
export const LAVA_LAMP = defineFlatScene(
	"lava-lamp",
	/* glsl */ `
/** How strongly one flow's three blobs claim this point; above 1 is wax. */
float wax(vec2 p, float flow, float aspect) {
  float f = 0.0;
  for (int i = ZERO; i < 3; i++) {
    float k = float(i) + flow * 3.0;
    vec2 c = vec2(
      sin(T * 0.23 + k * 2.1) * 0.32 * aspect,
      sin(T * (0.17 + 0.04 * k) + k * 1.3) * 0.36);
    float r = 0.09 + 0.03 * sin(k * 5.0);
    vec2 d = p - c;
    f += r * r / max(dot(d, d), 1e-4);
  }
  return f;
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  vec2 p = centred(uv, aspect);
  vec3 col = mix(vec3(0.22, 0.02, 0.12), vec3(0.05, 0.0, 0.1), smoothstep(-0.5, 0.5, p.y));
  col += vec3(0.4, 0.1, 0.2) * noise(p * 3.0 + vec2(0.0, -T * 0.2)) * 0.35;
  vec2 bub = p * 14.0 + vec2(0.0, -T * 1.2);
  vec2 cell = floor(bub);
  float ring = abs(length(fract(bub) - 0.5 - (hash22(cell) - 0.5) * 0.4) - 0.14);
  col += vec3(1.0, 0.6, 0.5) * step(0.8, hash21(cell)) * smoothstep(0.04, 0.0, ring) * 0.4;
  float id = 0.0;
  if (withElements()) {
    float a = wax(p, 0.0, aspect);
    float b = wax(p, 1.0, aspect);
    if (max(a, b) > 1.0) {
      bool amber = a > b;
      float core = smoothstep(1.0, 3.0, max(a, b));
      col = amber
        ? mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.9, 0.4), core)
        : mix(vec3(0.85, 0.1, 0.6), vec3(1.0, 0.6, 0.95), core);
      id = amber ? 1.0 : 2.0;
    }
  }
  return vec4(col, id);
}
`,
);
