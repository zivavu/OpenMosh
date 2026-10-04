import { clockParams } from "../clock-params";
import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "rgb-strobe",
	name: "RGB Strobe",
	params: [
		...clockParams(
			"Rate",
			{ min: 0.2, max: 20, step: 0.1, defaultValue: 4 },
			"flash",
			"flashes",
		),
		{
			key: "stagger",
			label: "Stagger",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.33,
		},
		{
			key: "duty",
			label: "Duty",
			type: "range",
			min: 0.05,
			max: 0.95,
			step: 0.01,
			defaultValue: 0.5,
		},
		{ key: "red", label: "Red", type: "checkbox", defaultValue: 1 },
		{ key: "green", label: "Green", type: "checkbox", defaultValue: 1 },
		{ key: "blue", label: "Blue", type: "checkbox", defaultValue: 1 },
	],
};

/** Vidvox RGB Strobe: each channel inverts on its own clock. One phase with a
 * per-channel stagger, so a mosh can roll it. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_red;
uniform float u_green;
uniform float u_blue;
uniform float u_stagger;
uniform float u_duty;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 phase = fract(vec3(u_time) + vec3(0.0, 1.0, 2.0) * u_stagger);
  vec3 on = step(phase, vec3(u_duty)) * vec3(u_red, u_green, u_blue);
  outColor = vec4(mix(c.rgb, 1.0 - c.rgb, on), c.a);
}`,
	animated: true,
	setUniforms: floats("red", "green", "blue", "stagger", "duty"),
};
