import { defineFlatScene } from "./common";

/** A banded, ringed planet (1) in a starfield with a moon (2) swinging around
 * it, in front and then behind. */
export const RINGED_PLANET = defineFlatScene(
	"ringed-planet",
	/* glsl */ `
const float R = 0.2;

vec2 moonAt() {
  float a = T * 0.5;
  return vec2(cos(a) * 0.46, sin(a) * 0.1 - 0.02);
}

bool moonInFront() {
  return sin(T * 0.5) < 0.0;
}

/** The planet and its ring, in the planet's tilted frame. */
bool planet(vec2 p, out vec3 col) {
  vec2 q = rot(0.35) * p;
  vec2 e = q * vec2(1.0, 3.6);
  float ring = length(e);
  bool onRing = ring > 0.27 && ring < 0.4 && fract(ring * 28.0) > 0.2;
  vec3 ringCol = mix(vec3(0.95, 0.75, 0.5), vec3(0.7, 0.45, 0.9), fract(ring * 7.0));
  if (onRing && q.y < 0.0) {
    col = ringCol;
    return true;
  }
  if (length(q) < R) {
    float band = sin(q.y * 42.0 + noise(q * 12.0 + T * 0.3) * 3.0);
    col = mix(vec3(0.95, 0.45, 0.25), vec3(1.0, 0.8, 0.5), 0.5 + 0.5 * band);
    col *= 0.35 + 0.65 * smoothstep(0.2, -0.15, q.x + q.y * 0.4);
    return true;
  }
  if (onRing) {
    col = ringCol;
    return true;
  }
  return false;
}

vec4 world(vec2 uv, float aspect, float time) {
  T = time;
  vec2 p = centred(uv, aspect);
  vec3 col = mix(vec3(0.01, 0.01, 0.05), vec3(0.12, 0.03, 0.2), noise(p * 2.5 + T * 0.05));
  col += vec3(0.1, 0.25, 0.4) * noise(p * 5.0 - T * 0.03) * 0.4;
  col += stars(p + vec2(T * 0.01, 0.0), 30.0, 0.09) + stars(p, 60.0, 0.07) * 0.5;
  float id = 0.0;
  if (withElements()) {
    vec2 m = p - moonAt();
    bool onMoon = length(m) < 0.05;
    vec3 moonCol = vec3(0.75, 0.8, 0.9) * (0.3 + 0.7 * smoothstep(0.05, -0.04, m.x + m.y));
    vec3 planetCol;
    bool onPlanet = planet(p, planetCol);
    if (onMoon && !moonInFront()) {
      col = moonCol;
      id = 2.0;
    }
    if (onPlanet) {
      col = planetCol;
      id = 1.0;
    }
    if (onMoon && moonInFront()) {
      col = moonCol;
      id = 2.0;
    }
  }
  return vec4(col, id);
}
`,
);
