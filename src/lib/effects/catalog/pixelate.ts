import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "pixelate",
	name: "Pixelate",
	// Curated rolls leave it out: it only fits when picked on purpose.
	moshable: false,
	params: [
		{
			key: "size",
			label: "Size",
			type: "range",
			min: 1,
			max: 100,
			step: 1,
			defaultValue: 10,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_size;
void main() {
  vec2 ts = vec2(textureSize(u_texture, 0));
  float cs = max(1.0, u_size);
  vec2 cell = (floor(v_uv * ts / cs) + 0.5) * cs;
  outColor = texture(u_texture, cell / ts);
}`,
	setUniforms: floats("size"),
};
