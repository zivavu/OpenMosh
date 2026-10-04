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
  vec2 center = vec2(0.5);
  vec2 uv = v_uv - center;
  float dist = length(uv);
  if (dist > 0.0 && dist < u_radius) {
    float pct = dist / u_radius;
    float distortion = pow(pct, 1.0 - u_amount) * u_radius;
    uv = uv / dist * distortion;
  }
  outColor = texture(u_texture, uv + center);
}`,
	setUniforms: floats("amount", "radius"),
};
