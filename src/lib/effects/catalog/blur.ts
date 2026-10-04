import { BLUR_H_FRAG, GLOW_VBLUR_FRAG, H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "blur",
	name: "Blur",
	params: [
		{
			key: "radius",
			label: "Radius",
			type: "range",
			min: 0,
			max: 20,
			step: 0.5,
			defaultValue: 5,
		},
	],
};

export const shader: EffectShaderDef = {
	prePasses: [
		{
			fragment: H + BLUR_H_FRAG,
			linearFilter: true,
		},
		{
			fragment: H + GLOW_VBLUR_FRAG,
			linearFilter: true,
		},
	],
	fragment:
		H +
		`void main() {
  outColor = texture(u_texture, v_uv);
}`,
	setUniforms: floats("radius"),
};
