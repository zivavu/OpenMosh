import { clockParams } from "../clock-params";
import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "screen-jump",
	name: "Screen Jump",
	params: [
		{
			key: "direction",
			label: "Direction",
			type: "select",
			defaultValue: "vertical",
			options: [
				{ label: "Vertical", value: "vertical" },
				{ label: "Horizontal", value: "horizontal" },
			],
		},
		{
			key: "intensity",
			label: "Intensity",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		...clockParams(
			"Speed",
			{ min: 0, max: 5, step: 0.05, defaultValue: 1 },
			"roll",
		),
	],
};

/** XPL GlitchScreenJump: the frame rolls like a lost vertical hold. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_intensity;
uniform int u_direction;
void main() {
  vec2 uv = v_uv;
  // Rolls upward on screen (v_uv.y is top-down), like a real vertical hold.
  if (u_direction == 0) {
    uv.x = mix(uv.x, fract(uv.x + u_time), u_intensity);
  } else {
    uv.y = mix(uv.y, fract(uv.y - u_time), u_intensity);
  }
  outColor = texture(u_texture, fract(uv));
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_intensity", v.intensity as number);
		setInt(gl, l, "u_direction", v.direction === "vertical" ? 1 : 0);
	},
};
