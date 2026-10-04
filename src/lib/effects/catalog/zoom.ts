import { BOUNCE_GLSL, H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "zoom",
	name: "Zoom",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: -1,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		BOUNCE_GLSL +
		`uniform float u_amount;
void main() {
  float scale = pow(2.0, u_amount);
  vec2 uv = (v_uv - 0.5) / scale + 0.5;
  uv = vec2(bounce(uv.x), bounce(uv.y));
  outColor = texture(u_texture, uv);
}`,
	setUniforms: floats("amount"),
};
