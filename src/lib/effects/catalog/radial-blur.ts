import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "radial-blur",
	name: "Radial Blur",
	params: [
		{
			key: "strength",
			label: "Strength",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.4,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_strength;
void main() {
  vec2 c = v_uv - 0.5;
  vec4 col = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0;
    float w = 1.0 - 0.5 * t;
    col += texture(u_texture, v_uv - c * t * u_strength * 0.25) * w;
    total += w;
  }
  outColor = col / total;
}`,
	setUniforms: floats("strength"),
};
