import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "scanlines",
	name: "Scanlines",
	params: [
		{
			key: "count",
			label: "Count",
			type: "range",
			min: 1,
			max: 500,
			step: 1,
			defaultValue: 100,
		},
		{
			key: "amount",
			label: "Amount",
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
		`uniform float u_count;
uniform float u_amount;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float line = sin((v_uv.y + u_time * 0.1) * u_count * 3.14159265) * 0.5 + 0.5;
  outColor = vec4(c.rgb * mix(1.0, line, u_amount), c.a);
}`,
	animated: true,
	setUniforms: floats("count", "amount"),
};
