import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "shake",
	name: "Shake",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 50,
			step: 1,
			defaultValue: 10,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 1,
			max: 60,
			step: 1,
			defaultValue: 20,
			curve: 5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_speed;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * u_speed);
  vec2 off = vec2(
    (hash(t) - 0.5) * 2.0,
    (hash(t + 7.0) - 0.5) * 2.0
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
	animated: true,
	setUniforms: floats("amount", "speed"),
};
