import { H, HSV_GLSL, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "hsv-swap",
	name: "HSV Swap",
	params: [
		{
			key: "mode",
			label: "Mode",
			type: "select",
			defaultValue: "rgb-as-hsv",
			options: [
				{ label: "Read RGB as HSV", value: "rgb-as-hsv" },
				{ label: "Show HSV as RGB", value: "hsv-as-rgb" },
			],
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
	],
};

/** Vidvox HSVtoRGB: read the channels as the other colour space. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		HSV_GLSL +
		`uniform int u_mode;
uniform float u_amount;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 o = u_mode == 0 ? hsv2rgb(c.rgb) : rgb2hsv(c.rgb);
  outColor = vec4(mix(c.rgb, o, u_amount), c.a);
}`,
	setUniforms: (gl, l, v) => {
		setInt(gl, l, "u_mode", v.mode === "rgb-as-hsv" ? 0 : 1);
		setFloat(gl, l, "u_amount", v.amount as number);
	},
};
