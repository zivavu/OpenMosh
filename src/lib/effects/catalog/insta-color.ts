import {
	H,
	HSV_GLSL,
	HUE_ROTATE_GLSL,
	setFloat,
	setInt,
} from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

/** Insta Color's grades as [value, label]; the shader indexes them in this order. */
const INSTA_COLOR_FILTERS = [
	["golden", "Golden Hour"],
	["ember", "Ember"],
	["sodium", "Sodium Lamp"],
	["seventies", "Seventies"],
	["warm-film", "Warm Film"],
	["evergreen", "Evergreen Film"],
	["instant", "Instant"],
	["matte", "Matte"],
	["lomo", "Lomo"],
	["cross-process", "Cross Process"],
	["negative", "Negative"],
	["teal-orange", "Teal & Orange"],
	["bleach-bypass", "Bleach Bypass"],
	["two-strip", "Two-Strip"],
	["day-for-night", "Day for Night"],
	["arctic", "Arctic"],
	["pop", "Pop"],
	["dreamy", "Dreamy"],
	["noir", "Noir"],
	["sepia", "Sepia"],
	["cyanotype", "Cyanotype"],
	["chrome", "Chrome"],
	["red-splash", "Red Splash"],
	["vaporwave", "Vaporwave"],
	["cyberpunk", "Cyberpunk"],
	["matrix", "Matrix"],
	["toxic", "Toxic"],
	["infrared", "Infrared"],
	["acid", "Acid"],
] as const;

const INSTA_COLOR_INDEX = new Map<string, number>(
	INSTA_COLOR_FILTERS.map(([value], i) => [value, i]),
);

export const definition: EffectDefinition = {
	id: "insta-color",
	name: "Insta Color",
	params: [
		{
			key: "filter",
			label: "Filter",
			type: "select",
			defaultValue: "golden",
			options: INSTA_COLOR_FILTERS.map(([value, label]) => ({
				label,
				value,
			})),
		},
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
	],
};

/** Photo-app colour grades: tone curves, blend layers and tints that keep
 * brightness, rolled off softly instead of clipping. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		HSV_GLSL +
		HUE_ROTATE_GLSL +
		`uniform int u_filter;
uniform float u_amount;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float lum(vec3 c) { return dot(c, LUMA); }
vec3 sat(vec3 c, float s) { return mix(vec3(lum(c)), c, s); }
/** Saturates dull colours more than vivid ones. */
vec3 vibrance(vec3 c, float v) {
  float s = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  return sat(c, 1.0 + v * (1.0 - s));
}
vec3 gam(vec3 c, vec3 g) { return pow(max(c, 0.0), g); }
/** Catmull-Rom curve through (0, a), (.25, b), (.5, m), (.75, d), (1, e). */
float spline(float x, float a, float b, float m, float d, float e) {
  float p[7] = float[7](2.0 * a - b, a, b, m, d, e, 2.0 * e - d);
  float s = clamp(x, 0.0, 1.0) * 4.0;
  int i = min(int(s), 3);
  float t = s - float(i);
  float p0 = p[i], p1 = p[i + 1], p2 = p[i + 2], p3 = p[i + 3];
  return 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
    + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t);
}
/** Per-channel tone curves, each through five points. */
vec3 curves(vec3 c, vec3 a, vec3 b, vec3 m, vec3 d, vec3 e) {
  return vec3(spline(c.r, a.r, b.r, m.r, d.r, e.r), spline(c.g, a.g, b.g, m.g, d.g, e.g),
    spline(c.b, a.b, b.b, m.b, d.b, e.b));
}
vec3 tone(vec3 c, float a, float b, float m, float d, float e) {
  return curves(c, vec3(a), vec3(b), vec3(m), vec3(d), vec3(e));
}
vec3 softLight(vec3 b, vec3 s) {
  vec3 d = mix(sqrt(max(b, 0.0)), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
}
vec3 overlay(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
}
vec3 screen(vec3 b, vec3 s) { return 1.0 - (1.0 - b) * (1.0 - s); }
/** A colour from the top of the frame to the bottom. */
vec3 vgrad(vec3 top, vec3 bottom) { return mix(top, bottom, v_uv.y); }
/** Moves c's brightness back to l, so a tint recolours without darkening. */
vec3 keepLum(vec3 c, float l) {
  float now = lum(c);
  return now > 1e-4 ? c * (l / now) : vec3(l);
}
/** Tints shadows and highlights apart, keeping each pixel's brightness. */
vec3 splitTone(vec3 c, vec3 shadow, vec3 highlight, float k) {
  float l = clamp(lum(c), 0.0, 1.0);
  vec3 tint = (shadow / max(lum(shadow), 1e-3) - 1.0) * (1.0 - smoothstep(0.0, 0.6, l))
            + (highlight / max(lum(highlight), 1e-3) - 1.0) * smoothstep(0.4, 1.0, l);
  return keepLum(c * (1.0 + tint * k), lum(c));
}
/** Rolls highlights off above 0.8 instead of clipping them flat. */
vec3 shoulder(vec3 c) {
  vec3 over = max(c - 0.8, 0.0);
  return min(c, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));
}
/** Maps brightness through four colours, dark to light. */
vec3 gradMap(float l, vec3 a, vec3 b, vec3 d, vec3 e) {
  l = clamp(l, 0.0, 1.0) * 3.0;
  return l < 1.0 ? mix(a, b, l) : l < 2.0 ? mix(b, d, l - 1.0) : mix(d, e, l - 2.0);
}
float hueDist(float from, float to) {
  float d = to - from;
  return d - floor(d + 0.5);
}
/** Moves every hue toward the nearer of two target hues. Hues about halfway
 * between stay put, so neighbouring pixels don't flip between the two. */
vec3 pullHue(vec3 c, float a, float b, float k) {
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  float da = hueDist(hsv.x, a);
  float db = hueDist(hsv.x, b);
  float sure = smoothstep(0.0, 0.12, abs(abs(da) - abs(db)));
  hsv.x = fract(hsv.x + (abs(da) < abs(db) ? da : db) * k * sure);
  return hsv2rgb(hsv);
}
vec3 vignette(vec3 c, float k) {
  vec2 d = v_uv - 0.5;
  return c * (1.0 - k * smoothstep(0.1, 0.55, dot(d, d) * 2.0));
}
/** Screens a ring-blurred copy of the highlights back in. */
vec3 bloom(vec3 c, float k) {
  vec2 size = vec2(textureSize(u_texture, 0));
  vec2 r = vec2(size.y / size.x, 1.0) * 0.012;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    sum += texture(u_texture, v_uv + vec2(cos(a), sin(a)) * r * (i % 2 == 0 ? 1.0 : 0.5)).rgb;
  }
  vec3 hi = max(sum / 12.0 - 0.45, 0.0) * 1.8;
  return screen(c, hi * k);
}

vec3 grade(vec3 c) {
  vec3 o = c;
  float l = lum(c);
  switch (u_filter) {
  case 0: // Golden Hour
    c = curves(c, vec3(0.03, 0.02, 0.02), vec3(0.27, 0.24, 0.2), vec3(0.55, 0.5, 0.42),
      vec3(0.81, 0.76, 0.66), vec3(1.0, 0.96, 0.84));
    c = mix(c, softLight(c, vgrad(vec3(1.0, 0.72, 0.38), vec3(0.85, 0.55, 0.45))), 0.45);
    return vignette(vibrance(c, 0.15), 0.2);
  case 1: // Ember
    c = curves(c, vec3(0.04, 0.0, 0.03), vec3(0.28, 0.2, 0.16), vec3(0.56, 0.44, 0.36),
      vec3(0.79, 0.68, 0.55), vec3(0.96, 0.9, 0.78));
    c = splitTone(c, vec3(0.5, 0.1, 0.4), vec3(1.0, 0.55, 0.2), 0.6);
    return vignette(shoulder(sat(c, 1.15)), 0.3);
  case 2: // Sodium Lamp
    c = gradMap(spline(l, 0.0, 0.2, 0.5, 0.8, 1.0), vec3(0.05, 0.02, 0.01), vec3(0.45, 0.17, 0.02),
      vec3(0.95, 0.55, 0.12), vec3(1.0, 0.93, 0.72));
    return mix(c, o * vec3(1.0, 0.7, 0.4), 0.12);
  case 3: // Seventies
    c = curves(c, vec3(0.1, 0.08, 0.05), vec3(0.3, 0.27, 0.2), vec3(0.54, 0.5, 0.4),
      vec3(0.77, 0.72, 0.6), vec3(0.95, 0.9, 0.76));
    c = mix(c, softLight(c, vec3(0.9, 0.72, 0.45)), 0.4);
    return vignette(sat(c, 0.8), 0.25);
  case 4: // Warm Film
    c = curves(c, vec3(0.04, 0.04, 0.05), vec3(0.27, 0.26, 0.25), vec3(0.53, 0.51, 0.48),
      vec3(0.79, 0.77, 0.72), vec3(0.99, 0.97, 0.92));
    c = splitTone(c, vec3(0.3, 0.5, 0.5), vec3(1.0, 0.85, 0.7), 0.3);
    return vibrance(sat(c, 0.95), 0.15);
  case 5: // Evergreen Film
    c = curves(c, vec3(0.03, 0.04, 0.05), vec3(0.24, 0.27, 0.27), vec3(0.5, 0.53, 0.5),
      vec3(0.77, 0.79, 0.75), vec3(0.98, 0.99, 0.95));
    c = splitTone(c, vec3(0.2, 0.55, 0.5), vec3(1.0, 0.93, 0.85), 0.35);
    return vibrance(c, 0.2);
  case 6: // Instant
    c = curves(c, vec3(0.12, 0.14, 0.15), vec3(0.32, 0.33, 0.32), vec3(0.56, 0.55, 0.5),
      vec3(0.8, 0.78, 0.7), vec3(0.97, 0.95, 0.86));
    c = splitTone(c, vec3(0.3, 0.55, 0.6), vec3(1.0, 0.88, 0.72), 0.35);
    return vignette(sat(c, 0.85), 0.25);
  case 7: // Matte
    c = tone(c, 0.12, 0.3, 0.52, 0.74, 0.92);
    return splitTone(sat(c, 0.8), vec3(0.4, 0.48, 0.6), vec3(1.0, 0.95, 0.88), 0.25);
  case 8: // Lomo
    c = tone(c, 0.0, 0.18, 0.5, 0.84, 1.0);
    c = splitTone(c, vec3(0.2, 0.4, 0.8), vec3(1.0, 0.92, 0.5), 0.4);
    return vignette(shoulder(vibrance(sat(c, 1.15), 0.3)), 0.55);
  case 9: // Cross Process
    c = curves(c, vec3(0.0, 0.0, 0.18), vec3(0.15, 0.24, 0.3), vec3(0.5, 0.56, 0.45),
      vec3(0.86, 0.84, 0.6), vec3(1.0, 1.0, 0.75));
    return vignette(shoulder(sat(c, 1.1)), 0.2);
  case 10: // Negative
    return curves(1.0 - c, vec3(0.08, 0.05, 0.03), vec3(0.32, 0.22, 0.14), vec3(0.6, 0.46, 0.32),
      vec3(0.83, 0.7, 0.55), vec3(1.0, 0.88, 0.72));
  case 11: // Teal & Orange
    c = tone(c, 0.02, 0.22, 0.5, 0.79, 0.98);
    c = splitTone(c, vec3(0.0, 0.5, 0.55), vec3(1.0, 0.62, 0.32), 0.5);
    return vignette(vibrance(c, 0.2), 0.15);
  case 12: // Bleach Bypass
    c = mix(c, overlay(c, vec3(l)), 0.6);
    c = tone(sat(c, 0.45), 0.02, 0.2, 0.5, 0.8, 0.97) * vec3(0.98, 1.0, 1.02);
    return vignette(shoulder(c), 0.2);
  case 13: { // Two-Strip
    float cy = (c.g + c.b) * 0.5;
    c = vec3(c.r, cy * 0.95 + c.r * 0.05, cy);
    c = tone(sat(c, 1.2), 0.03, 0.24, 0.5, 0.78, 0.97);
    return c * vec3(1.0, 0.98, 0.94);
  }
  case 14: // Day for Night
    c = gam(sat(c, 0.45), vec3(1.7, 1.45, 1.15)) * vec3(0.5, 0.68, 1.0);
    c += vec3(0.6, 0.75, 1.0) * pow(l, 5.0) * 0.35;
    return vignette(tone(c, 0.0, 0.2, 0.47, 0.73, 1.0), 0.35);
  case 15: // Arctic
    c = curves(c, vec3(0.06, 0.08, 0.11), vec3(0.28, 0.3, 0.34), vec3(0.53, 0.56, 0.6),
      vec3(0.78, 0.81, 0.85), vec3(0.98, 0.99, 1.0));
    return splitTone(sat(c, 0.7), vec3(0.3, 0.5, 0.7), vec3(0.9, 0.97, 1.0), 0.3);
  case 16: // Pop
    c = tone(c, 0.0, 0.21, 0.5, 0.78, 0.97);
    return shoulder(sat(vibrance(c, 0.5), 1.05));
  case 17: // Dreamy
    c = bloom(c, 0.6);
    c = tone(c, 0.1, 0.33, 0.58, 0.82, 1.0);
    c = mix(c, softLight(c, vgrad(vec3(1.0, 0.8, 0.9), vec3(0.75, 0.7, 0.95))), 0.5);
    return sat(c, 0.85);
  case 18: { // Noir
    float g = dot(c, vec3(0.3, 0.6, 0.1));
    return vignette(vec3(spline(g, 0.02, 0.17, 0.48, 0.83, 1.0)), 0.4);
  }
  case 19: // Sepia
    c = gradMap(spline(l, 0.03, 0.24, 0.5, 0.77, 0.97), vec3(0.1, 0.06, 0.03),
      vec3(0.38, 0.25, 0.15), vec3(0.72, 0.56, 0.38), vec3(1.0, 0.95, 0.83));
    return vignette(c, 0.25);
  case 20: // Cyanotype
    return gradMap(spline(l, 0.0, 0.25, 0.52, 0.78, 1.0), vec3(0.02, 0.07, 0.2),
      vec3(0.07, 0.26, 0.5), vec3(0.4, 0.62, 0.8), vec3(0.94, 0.97, 0.98));
  case 21: // Chrome
    c = tone(mix(vec3(l), c, 0.35), 0.02, 0.17, 0.5, 0.85, 1.0) * vec3(0.95, 0.99, 1.04);
    return shoulder(c + pow(l, 6.0) * 0.15);
  case 22: { // Red Splash
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float keep = smoothstep(0.1, 0.04, abs(hueDist(hsv.x, 0.0))) * smoothstep(0.2, 0.45, hsv.y);
    return mix(tone(vec3(l), 0.02, 0.2, 0.5, 0.8, 0.98), shoulder(sat(c, 1.3)), keep);
  }
  case 23: // Vaporwave
    c = pullHue(c, 0.9, 0.5, 0.7);
    c = splitTone(c, vec3(0.45, 0.15, 0.8), vec3(0.6, 1.0, 0.95), 0.5);
    c = curves(c, vec3(0.14, 0.06, 0.22), vec3(0.34, 0.26, 0.4), vec3(0.58, 0.5, 0.6),
      vec3(0.8, 0.75, 0.8), vec3(0.98, 0.96, 0.98));
    return mix(c, softLight(c, vgrad(vec3(1.0, 0.45, 0.8), vec3(0.35, 0.85, 1.0))), 0.35);
  case 24: // Cyberpunk
    c = pullHue(c, 0.87, 0.52, 0.6);
    c = splitTone(c, vec3(0.25, 0.1, 0.7), vec3(1.0, 0.5, 0.95), 0.5);
    c = tone(c, 0.02, 0.2, 0.5, 0.8, 1.0);
    return vignette(shoulder(sat(c, 1.35)), 0.3);
  case 25: { // Matrix
    vec3 map = gradMap(spline(l, 0.0, 0.2, 0.5, 0.8, 1.0), vec3(0.0, 0.03, 0.01),
      vec3(0.02, 0.28, 0.06), vec3(0.25, 0.75, 0.25), vec3(0.85, 1.0, 0.8));
    return vignette(mix(map, softLight(map, sat(o, 0.4)), 0.45), 0.35);
  }
  case 26: // Toxic
    c = pullHue(c, 0.22, 0.8, 0.75);
    c = splitTone(c, vec3(0.1, 0.5, 0.0), vec3(0.85, 1.0, 0.2), 0.6);
    c = tone(c, 0.02, 0.2, 0.5, 0.8, 0.98);
    return shoulder(sat(c, 1.4));
  case 27: // Infrared
    c = vec3(0.15 * c.r + 0.9 * c.g, 0.85 * c.r + 0.1 * c.g + 0.05 * c.b, c.b);
    c = splitTone(c, vec3(0.3, 0.2, 0.5), vec3(1.0, 0.8, 0.85), 0.35);
    return shoulder(tone(sat(c, 1.2), 0.02, 0.22, 0.5, 0.79, 1.0));
  case 28: { // Acid
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    hsv.x = fract(hsv.x + hsv.z * 1.3 + 0.1);
    hsv.y = clamp(hsv.y * 1.5 + 0.25, 0.0, 1.0);
    return tone(hsv2rgb(hsv), 0.02, 0.22, 0.5, 0.8, 0.98);
  }
  }
  return o;
}

void main() {
  vec4 c = texture(u_texture, v_uv);
  outColor = vec4(mix(c.rgb, clamp(grade(c.rgb), 0.0, 1.0), u_amount), c.a);
}`,
	setUniforms: (gl, l, v) => {
		setInt(gl, l, "u_filter", INSTA_COLOR_INDEX.get(v.filter as string) ?? 0);
		setFloat(gl, l, "u_amount", v.amount as number);
	},
};
