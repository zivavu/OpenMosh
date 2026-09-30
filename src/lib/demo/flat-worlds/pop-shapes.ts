import { defineFlatScene } from "./common";

/** Memphis-style pop art over scrolling stripes: a bouncing ball (1), a spinning
 * tile (2) and a wriggling squiggle (3), each with a hard drop shadow. */
export const POP_SHAPES = defineFlatScene(
	"pop-shapes",
	/* glsl */ `
vec2 ballAt(float aspect) {
  return vec2(sin(T * 0.6) * 0.3 * aspect, -0.18 + abs(sin(T * 1.8)) * 0.34);
}

vec2 tileAt(float aspect) {
  return vec2(0.3 * aspect + 0.04 * sin(T * 0.9), 0.12 + 0.06 * sin(T * 0.7));
}

vec2 squiggleAt(float aspect) {
  return vec2(-0.28 * aspect, 0.22 + 0.04 * sin(T * 1.3));
}

float ball(vec2 p, float aspect) {
  return length(p - ballAt(aspect)) - 0.12;
}

float tile(vec2 p, float aspect) {
  vec2 q = (p - tileAt(aspect)) * rot(T * 0.8);
  return sdBox(q, vec2(0.08)) - 0.015;
}

float squiggle(vec2 p, float aspect) {
  vec2 q = p - squiggleAt(aspect);
  float wave = q.y - 0.035 * sin(q.x * 38.0 - T * 5.0);
  return max(abs(wave) - 0.018, abs(q.x) - 0.2);
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  vec2 p = centred(uv, aspect);
  float stripe = step(0.5, fract((p.x + p.y) * 9.0 - T * 0.4));
  vec3 col = mix(vec3(0.1, 0.72, 0.68), vec3(0.06, 0.6, 0.58), stripe);
  vec2 dots = fract(p * 18.0) - 0.5;
  col = mix(col, vec3(1.0, 0.95, 0.85), smoothstep(0.12, 0.08, length(dots)) * step(0.3, p.y + 0.5 * sin(T * 0.2)));
  vec2 below = p - vec2(0.018, -0.018);
  float shadow = min(ball(below, aspect), min(tile(below, aspect), squiggle(below, aspect)));
  if (shadow < 0.0) col = vec3(0.08, 0.05, 0.12);
  float id = 0.0;
  if (withElements()) {
    if (ball(p, aspect) < 0.0) {
      vec2 q = p - ballAt(aspect);
      col = mix(vec3(1.0, 0.85, 0.1), vec3(1.0, 0.5, 0.1), step(0.0, q.x - q.y));
      id = 1.0;
    } else if (tile(p, aspect) < 0.0) {
      vec2 q = (p - tileAt(aspect)) * rot(T * 0.8);
      col = mix(vec3(1.0, 0.3, 0.55), vec3(0.2, 0.1, 0.3), step(0.5, fract(q.y * 20.0)) * 0.25);
      id = 2.0;
    } else if (squiggle(p, aspect) < 0.0) {
      col = vec3(0.25, 0.3, 1.0);
      id = 3.0;
    }
  }
  return vec4(col, id);
}
`,
);
