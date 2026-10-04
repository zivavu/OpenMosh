import { clockParams } from "../clock-params";
import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "strobe",
	name: "Strobe",
	params: [
		...clockParams(
			"Rate",
			{ min: 0.2, max: 20, step: 0.1, defaultValue: 5 },
			"flash",
			"flashes",
		),
		{
			key: "duty",
			label: "Duty",
			type: "range",
			min: 0.05,
			max: 0.95,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "mode",
			label: "Mode",
			type: "select",
			defaultValue: "black",
			options: [
				{ label: "Blackout", value: "black" },
				{ label: "Whiteout", value: "white" },
				{ label: "Invert", value: "invert" },
				{ label: "Mono", value: "mono" },
			],
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_duty;
uniform float u_amount;
uniform int u_mode;
void main() {
  vec4 c = texture(u_texture, v_uv);
  // u_time arrives as accumulated phase because the rate param is keyed "speed".
  float phase = fract(u_time);
  float on = step(phase, u_duty);
  vec3 flash = u_mode == 1 ? vec3(1.0)
             : u_mode == 2 ? 1.0 - c.rgb
             : u_mode == 3 ? vec3(dot(c.rgb, vec3(0.299, 0.587, 0.114)))
             : vec3(0.0);
  outColor = vec4(mix(c.rgb, flash, on * u_amount), c.a);
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_duty", v.duty as number);
		setFloat(gl, l, "u_amount", v.amount as number);
		setInt(
			gl,
			l,
			"u_mode",
			v.mode === "white"
				? 1
				: v.mode === "invert"
					? 2
					: v.mode === "mono"
						? 3
						: 0,
		);
	},
};
