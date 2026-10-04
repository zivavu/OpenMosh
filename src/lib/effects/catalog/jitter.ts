import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "jitter",
	name: "Jitter",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 100,
			step: 1,
			defaultValue: 20,
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
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 15.0);
  vec2 off = vec2(
    hash(vec2(floor(v_uv.y * 500.0), t)) - 0.5,
    hash(vec2(floor(v_uv.x * 500.0), t + 1.0)) - 0.5
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
	animated: true,
	setUniforms: floats("amount"),
};
