import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "emboss",
	name: "Emboss",
	params: [
		{
			key: "strength",
			label: "Strength",
			type: "range",
			min: 0,
			max: 5,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 360,
			step: 1,
			defaultValue: 135,
		},
		{
			key: "mix",
			label: "Mix",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_strength;
uniform float u_angle;
uniform float u_mix;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad));
  vec2 off = dir * max(px.x, px.y) * 2.0;
  float s1 = dot(texture(u_texture, v_uv - off).rgb, vec3(0.299, 0.587, 0.114));
  float s2 = dot(texture(u_texture, v_uv + off).rgb, vec3(0.299, 0.587, 0.114));
  float diff = (s2 - s1) * u_strength + 0.5;
  vec3 emboss = clamp(vec3(diff), 0.0, 1.0);
  vec4 orig = texture(u_texture, v_uv);
  outColor = vec4(mix(orig.rgb, emboss, u_mix), orig.a);
}`,
	setUniforms: floats("strength", "angle", "mix"),
};
