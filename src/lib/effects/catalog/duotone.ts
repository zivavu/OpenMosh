import { H, setColor, setFloat } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "duotone",
	name: "Duotone",
	params: [
		{
			key: "shadowColor",
			label: "Shadow",
			type: "color",
			defaultValue: "#00194d",
		},
		{
			key: "highlightColor",
			label: "Highlight",
			type: "color",
			defaultValue: "#ffaa00",
		},
		{
			key: "intensity",
			label: "Intensity",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform vec3 u_shadowColor;
uniform vec3 u_highlightColor;
uniform float u_intensity;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 duo = mix(u_shadowColor, u_highlightColor, luma);
  outColor = vec4(mix(c.rgb, duo, u_intensity), c.a);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_intensity", v.intensity as number);
		setColor(gl, l, "u_shadowColor", v.shadowColor as string);
		setColor(gl, l, "u_highlightColor", v.highlightColor as string);
	},
};
