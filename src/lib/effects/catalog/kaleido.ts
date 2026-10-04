import { BOUNCE_GLSL, H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "kaleido",
	name: "Kaleido",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "sides",
			label: "Sides",
			type: "range",
			min: 2,
			max: 12,
			step: 1,
			defaultValue: 6,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 360,
			step: 1,
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		BOUNCE_GLSL +
		`uniform float u_amount;
uniform float u_sides;
uniform float u_angle;
void main() {
  vec2 uv = v_uv - 0.5;
  float r = length(uv);
  float a = atan(uv.y, uv.x) + u_angle * 0.01745329;
  float seg = 6.28318530 / u_sides;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 kUV = vec2(cos(a), sin(a)) * r + 0.5;
  kUV = vec2(bounce(kUV.x), bounce(kUV.y));
  outColor = mix(texture(u_texture, v_uv), texture(u_texture, kUV), u_amount);
}`,
	setUniforms: floats("amount", "sides", "angle"),
};
