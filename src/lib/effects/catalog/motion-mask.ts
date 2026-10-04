import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "motion-mask",
	name: "Motion Mask",
	params: [
		{
			key: "threshold",
			label: "Threshold",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.25,
			moshMax: 0.5,
		},
		{
			key: "persistence",
			label: "Persistence",
			type: "range",
			min: 0.9,
			max: 1,
			step: 0.001,
			defaultValue: 0.95,
		},
		{
			key: "erode",
			label: "Erode",
			type: "range",
			min: 0,
			max: 6,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "blur",
			label: "Blur",
			type: "range",
			min: 0,
			max: 6,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "still",
			label: "Still",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "showMask",
			label: "Output Mask",
			type: "checkbox",
			defaultValue: 0,
		},
		{
			key: "hardCutoff",
			label: "Hard Cutoff",
			type: "checkbox",
			defaultValue: 1,
		},
	],
};

/** Vidvox Motion Mask: only what differs from a slowly settling background
 * estimate shows through. The estimate is a stateful pre-pass. */
export const shader: EffectShaderDef = {
	prePasses: [
		{
			fragment:
				H +
				`uniform float u_persistence;
uniform sampler2D u_feedback;
void main() {
  outColor = mix(texture(u_texture, v_uv), texture(u_feedback, v_uv), u_persistence);
}`,
			feedback: true,
		},
		{
			fragment:
				H +
				`uniform sampler2D u_original;
void main() {
  vec3 s = texture(u_original, v_uv).rgb;
  vec3 b = texture(u_texture, v_uv).rgb;
  outColor = vec4(abs(s.r - b.r) + abs(s.g - b.g) + abs(s.b - b.b));
}`,
		},
		{
			fragment:
				H +
				`uniform float u_erode;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float m = 1e9;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > u_erode) continue;
    m = min(m, texture(u_texture, v_uv + vec2(float(i) * px.x, 0.0)).r);
  }
  outColor = vec4(m);
}`,
		},
		{
			fragment:
				H +
				`uniform float u_erode;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float m = 1e9;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > u_erode) continue;
    m = min(m, texture(u_texture, v_uv + vec2(0.0, float(i) * px.y)).r);
  }
  outColor = vec4(m);
}`,
		},
		{
			fragment:
				H +
				`uniform float u_blur;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float r = floor(u_blur);
  float sum = 0.0;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > r) continue;
    sum += texture(u_texture, v_uv + vec2(float(i) * px.x, 0.0)).r;
  }
  outColor = vec4(sum / (2.0 * r + 1.0));
}`,
		},
		{
			fragment:
				H +
				`uniform float u_blur;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float r = floor(u_blur);
  float sum = 0.0;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > r) continue;
    sum += texture(u_texture, v_uv + vec2(0.0, float(i) * px.y)).r;
  }
  outColor = vec4(sum / (2.0 * r + 1.0));
}`,
		},
	],
	fragment:
		H +
		`uniform float u_threshold;
uniform float u_still;
uniform float u_showMask;
uniform float u_hardCutoff;
uniform sampler2D u_original;
void main() {
  vec4 src = texture(u_original, v_uv);
  float m = texture(u_texture, v_uv).r;
  // What holds still shows through at u_still; nothing at all at 0.
  vec4 base = src * u_still;
  if (m <= u_threshold) {
    outColor = base;
    return;
  }
  vec4 moving = u_showMask > 0.5 ? vec4(1.0) : src;
  float w = u_hardCutoff > 0.5 ? 1.0 : clamp(m, 0.0, 1.0);
  outColor = mix(base, moving, w);
}`,
	animated: true,
	setUniforms: floats(
		"threshold",
		"persistence",
		"erode",
		"blur",
		"still",
		"showMask",
		"hardCutoff",
	),
};
