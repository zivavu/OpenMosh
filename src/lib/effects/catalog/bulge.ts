import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "bulge",
	name: "Bulge",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: -1,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "radius",
			label: "Radius",
			type: "range",
			min: 0.01,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_radius;
void main() {
  vec2 uv = v_uv - 0.5;
  float p = length(uv) / u_radius;
  if (p < 1.0) {
    // Bounded zoom (at most ~16x) so the centre magnifies instead of smearing into rays.
    float a = u_amount > 0.0 ? 0.94 * u_amount * (2.0 - u_amount) : 1.1 * u_amount;
    float q = 1.0 - p * p;
    uv *= 1.0 - a * q * q;
  }
  outColor = texture(u_texture, uv + 0.5);
}`,
	setUniforms: floats("amount", "radius"),
};
