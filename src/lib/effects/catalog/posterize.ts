import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "posterize",
	name: "Posterize",
	params: [
		{
			key: "levels",
			label: "Levels",
			type: "range",
			min: 2,
			max: 20,
			step: 1,
			defaultValue: 8,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_levels;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float n = max(2.0, u_levels);
  outColor = vec4(floor(c.rgb * n + 0.5) / n, c.a);
}`,
	setUniforms: floats("levels"),
};
