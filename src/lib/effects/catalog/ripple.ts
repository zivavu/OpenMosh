import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "ripple",
	name: "Ripple",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 100,
			step: 0.5,
			defaultValue: 10,
		},
		{
			key: "frequency",
			label: "Frequency",
			type: "range",
			min: 1,
			max: 30,
			step: 0.5,
			defaultValue: 8,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0.1,
			max: 5,
			step: 0.1,
			defaultValue: 1,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_frequency;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 px = 1.0 / res;
  float aspect = res.x / res.y;
  vec2 c = v_uv - 0.5;
  c.x *= aspect;
  float d = length(c);
  float wave = sin(d * u_frequency * 6.2831 - u_time * 4.0) / (1.0 + d * 3.0);
  vec2 dir = d > 0.0001 ? c / d : vec2(0.0);
  vec2 uv = v_uv + dir * wave * u_amount * px;
  outColor = texture(u_texture, uv);
}`,
	animated: true,
	setUniforms: floats("amount", "frequency"),
};
