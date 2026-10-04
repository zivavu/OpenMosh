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

/** Photo-app colour grades, each built from the same few grading tools. */
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
vec3 sCurve(vec3 c, float k) {
  c = clamp(c, 0.0, 1.0);
  return mix(c, c * c * (3.0 - 2.0 * c), k);
}
vec3 gam(vec3 c, vec3 g) { return pow(max(c, 0.0), g); }
vec3 levels(vec3 c, vec3 black, vec3 white) { return mix(black, white, c); }
vec3 ramp3(float t, vec3 a, vec3 b, vec3 c) {
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
}
vec3 overlay(vec3 base, vec3 blend) {
  return mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(0.5, base));
}
/** Tints shadows and highlights apart, leaving brightness alone. */
vec3 splitTone(vec3 c, vec3 shadow, vec3 highlight, float k) {
  float l = clamp(lum(c), 0.0, 1.0);
  vec3 tint = (shadow - lum(shadow)) * (1.0 - smoothstep(0.0, 0.7, l))
            + (highlight - lum(highlight)) * smoothstep(0.3, 1.0, l);
  return c + tint * k;
}
float hueDist(float from, float to) {
  float d = to - from;
  return d - floor(d + 0.5);
}
/** Moves every hue toward the nearer of two target hues. */
vec3 pullHue(vec3 c, float a, float b, float k) {
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  float da = hueDist(hsv.x, a);
  float db = hueDist(hsv.x, b);
  hsv.x = fract(hsv.x + (abs(da) < abs(db) ? da : db) * k);
  return hsv2rgb(hsv);
}
vec3 vignette(vec3 c, vec3 edge) {
  vec2 d = v_uv - 0.5;
  return c * mix(vec3(1.0), edge, smoothstep(0.15, 1.0, dot(d, d) * 2.0));
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
  return 1.0 - (1.0 - c) * (1.0 - hi * k);
}

vec3 grade(vec3 c) {
  vec3 o = c;
  float l = lum(c);
  switch (u_filter) {
  case 0: // Golden Hour
    c = gam(c, vec3(0.92, 0.97, 1.12));
    c = splitTone(c, vec3(0.55, 0.35, 0.3), vec3(1.0, 0.78, 0.4), 0.6);
    c = vibrance(sCurve(c, 0.25), 0.3);
    c = levels(c, vec3(0.05, 0.03, 0.02), vec3(1.0, 0.97, 0.88));
    return vignette(c, vec3(0.75, 0.7, 0.65));
  case 1: // Ember
    c = gam(c, vec3(0.82, 1.05, 1.3));
    c = splitTone(c, vec3(0.45, 0.1, 0.55), vec3(1.0, 0.55, 0.2), 0.8);
    c = sat(sCurve(c, 0.4), 1.25);
    return vignette(c, vec3(0.6, 0.5, 0.55));
  case 2: // Sodium Lamp
    l = lum(sCurve(c, 0.2));
    return mix(c, ramp3(l, vec3(0.04, 0.01, 0.0), vec3(0.95, 0.45, 0.05), vec3(1.0, 0.92, 0.7)), 0.88);
  case 3: // Seventies
    c = hueRotate(sat(c, 0.75), -12.0);
    c = gam(c, vec3(0.9, 0.95, 1.25));
    c = levels(c, vec3(0.12, 0.08, 0.05), vec3(0.96, 0.9, 0.74));
    return vignette(c, vec3(0.8, 0.72, 0.62));
  case 4: // Warm Film
    c = splitTone(c, vec3(0.3, 0.45, 0.4), vec3(1.0, 0.82, 0.68), 0.5);
    c = sCurve(gam(c, vec3(0.96, 0.98, 1.04)), 0.15);
    c = vibrance(sat(c, 0.9), 0.15);
    return levels(c, vec3(0.04, 0.04, 0.05), vec3(1.0, 0.97, 0.93));
  case 5: // Evergreen Film
    c = splitTone(c, vec3(0.1, 0.45, 0.4), vec3(0.95, 0.85, 0.95), 0.6);
    c = sat(sCurve(gam(c, vec3(1.04, 0.97, 1.0)), 0.4), 1.1);
    return levels(c, vec3(0.02, 0.04, 0.04), vec3(0.98, 1.0, 0.97));
  case 6: // Instant
    c = sat(sCurve(c, 0.3), 0.85);
    c = splitTone(c, vec3(0.2, 0.5, 0.5), vec3(1.0, 0.9, 0.7), 0.5);
    c = levels(c, vec3(0.1, 0.13, 0.13), vec3(0.98, 0.95, 0.84));
    return vignette(c, vec3(0.75, 0.62, 0.5));
  case 7: // Matte
    c = sat(sCurve(c, 0.3), 0.72);
    c = splitTone(c, vec3(0.3, 0.4, 0.55), vec3(0.95, 0.9, 0.8), 0.3);
    return levels(c, vec3(0.13, 0.13, 0.15), vec3(0.9, 0.89, 0.86));
  case 8: // Lomo
    c = sCurve(sCurve(c, 0.7), 0.4);
    c = splitTone(c, vec3(0.1, 0.3, 0.7), vec3(1.0, 0.9, 0.3), 0.6);
    return vignette(sat(c, 1.4), vec3(0.25));
  case 9: // Cross Process
    c = clamp(c, 0.0, 1.0);
    c.r = smoothstep(0.05, 0.95, c.r);
    c.g = mix(pow(c.g, 0.85), smoothstep(0.0, 1.0, c.g), 0.4);
    c.b = 0.2 + c.b * 0.58;
    return vignette(sat(c, 1.2), vec3(0.7));
  case 10: // Negative
    c = mix(vec3(0.12, 0.06, 0.03), vec3(1.0, 0.75, 0.5), 1.0 - clamp(c, 0.0, 1.0));
    return sCurve(c, 0.2);
  case 11: // Teal & Orange
    c = pullHue(c, 0.07, 0.5, 0.5);
    c = splitTone(c, vec3(0.0, 0.45, 0.55), vec3(1.0, 0.6, 0.3), 0.6);
    c = vibrance(sCurve(c, 0.45), 0.25);
    return vignette(c, vec3(0.8));
  case 12: // Bleach Bypass
    c = mix(c, overlay(vec3(l), c), 0.9);
    c = sCurve(sat(c, 0.45), 0.35) * vec3(0.97, 1.0, 1.03);
    return vignette(c, vec3(0.8));
  case 13: { // Two-Strip
    float cy = (c.g + c.b) * 0.5;
    c = vec3(c.r, cy * 0.95 + c.r * 0.05, cy);
    c = sat(sCurve(c, 0.3), 1.3);
    return levels(c, vec3(0.04, 0.02, 0.02), vec3(1.0, 0.97, 0.92));
  }
  case 14: // Day for Night
    c = gam(sat(c, 0.45), vec3(1.7, 1.45, 1.15)) * vec3(0.5, 0.68, 1.0);
    c += vec3(0.6, 0.75, 1.0) * pow(l, 5.0) * 0.35;
    c = levels(c, vec3(0.0, 0.01, 0.04), vec3(1.0));
    return vignette(c, vec3(0.6));
  case 15: // Arctic
    c = gam(sat(c, 0.7), vec3(1.12, 1.0, 0.88));
    c = splitTone(c, vec3(0.2, 0.5, 0.7), vec3(0.85, 0.95, 1.0), 0.5);
    return levels(c, vec3(0.05, 0.08, 0.11), vec3(1.02, 1.06, 1.1));
  case 16: // Pop
    c = sat(vibrance(sCurve(c, 0.45), 0.6), 1.2);
    return levels(c, vec3(-0.02), vec3(1.03));
  case 17: // Dreamy
    c = bloom(c, 0.7);
    c = 1.0 - (1.0 - c) * (1.0 - c * 0.4);
    c = splitTone(sat(c, 0.8), vec3(0.55, 0.4, 0.75), vec3(1.0, 0.8, 0.9), 0.6);
    return levels(c, vec3(0.1, 0.07, 0.12), vec3(1.0, 0.97, 0.98));
  case 18: // Noir
    l = smoothstep(0.03, 0.97, dot(c, vec3(0.45, 0.45, 0.1)));
    return vignette(sCurve(vec3(l), 0.5), vec3(0.55));
  case 19: // Sepia
    l = sCurve(vec3(l), 0.25).x;
    c = ramp3(l, vec3(0.12, 0.07, 0.04), vec3(0.62, 0.45, 0.3), vec3(1.0, 0.95, 0.82));
    return vignette(levels(c, vec3(0.05, 0.03, 0.02), vec3(0.97)), vec3(0.7, 0.62, 0.55));
  case 20: // Cyanotype
    l = sCurve(vec3(l), 0.3).x;
    return ramp3(l, vec3(0.02, 0.1, 0.28), vec3(0.18, 0.45, 0.72), vec3(0.9, 0.95, 0.97));
  case 21: // Chrome
    c = mix(vec3(l) * vec3(0.93, 0.98, 1.05), c, 0.2);
    return sCurve(sCurve(c, 1.0), 0.6) + pow(l, 6.0) * 0.25;
  case 22: { // Red Splash
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float keep = smoothstep(0.1, 0.04, abs(hueDist(hsv.x, 0.0))) * smoothstep(0.2, 0.45, hsv.y);
    return mix(sCurve(vec3(l), 0.4), sat(c, 1.35), keep);
  }
  case 23: // Vaporwave
    c = mix(c, ramp3(l, vec3(0.2, 0.03, 0.4), vec3(1.0, 0.3, 0.7), vec3(0.6, 1.0, 0.95)), 0.6);
    return levels(sat(c, 1.3), vec3(0.08, 0.02, 0.14), vec3(1.0));
  case 24: // Cyberpunk
    c = pullHue(c, 0.87, 0.52, 0.65);
    c = splitTone(c, vec3(0.2, 0.1, 0.6), vec3(1.0, 0.5, 0.9), 0.5);
    return vignette(sat(gam(c, vec3(1.2)), 1.45), vec3(0.65));
  case 25: // Matrix
    c = mix(c, vec3(pow(l, 1.8) * 0.55, pow(l, 0.85), pow(l, 1.4) * 0.45), 0.85);
    return vignette(sCurve(c, 0.4), vec3(0.6));
  case 26: // Toxic
    c = mix(c, ramp3(l, vec3(0.04, 0.12, 0.0), vec3(0.55, 0.95, 0.05), vec3(1.0, 0.45, 0.95)), 0.75);
    return sat(c, 1.2);
  case 27: // Infrared
    c = vec3(0.15 * c.r + 0.95 * c.g, 0.85 * c.r + 0.1 * c.g + 0.05 * c.b, c.b);
    c = splitTone(c, vec3(0.3, 0.2, 0.5), vec3(1.0, 0.75, 0.85), 0.4);
    return sCurve(sat(c, 1.25), 0.3);
  case 28: { // Acid
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    hsv.x = fract(hsv.x + hsv.z * 1.3 + 0.1);
    hsv.y = clamp(hsv.y * 1.6 + 0.25, 0.0, 1.0);
    return sCurve(hsv2rgb(hsv), 0.3);
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
