import { H, setColor, setFloat } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "ghosting",
	name: "Ghosting",
	params: [
		{
			key: "bias",
			label: "Bias",
			type: "range",
			min: -1,
			max: 0,
			step: 0.01,
			defaultValue: -0.5,
		},
		{
			key: "scale",
			label: "Scale",
			type: "range",
			min: 0,
			max: 2,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "ghosts",
			label: "Ghosts",
			type: "range",
			min: 1,
			max: 5,
			step: 1,
			defaultValue: 5,
		},
		{
			key: "dispersal",
			label: "Dispersal",
			type: "range",
			min: 0,
			max: 0.5,
			step: 0.0025,
			defaultValue: 0.0125,
			curve: 2,
		},
		{
			key: "dirX",
			label: "Direction X",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "dirY",
			label: "Direction Y",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "lensColor",
			label: "Lens Color",
			type: "color",
			defaultValue: "#e6ccb3",
		},
		{
			key: "additive",
			label: "Additive",
			type: "checkbox",
			defaultValue: 1,
		},
	],
};

/** Vidvox Ghosting: thresholded copies of the frame, spread toward a point
 * and tinted, as a lens throws ghosts of a bright light. */
export const shader: EffectShaderDef = {
	prePasses: [
		{
			fragment:
				H +
				`uniform float u_bias;
uniform float u_scale;
void main() {
  outColor = max(vec4(0.0), texture(u_texture, v_uv) + u_bias) * u_scale;
}`,
			linearFilter: true,
		},
	],
	fragment:
		H +
		`uniform float u_ghosts;
uniform float u_dispersal;
uniform float u_additive;
uniform float u_dirX;
uniform float u_dirY;
uniform vec3 u_lensColor;
uniform sampler2D u_original;
void main() {
  vec2 dir = vec2(1.0) - vec2(u_dirX, u_dirY);
  vec2 ghostVec = (dir - v_uv) * u_dispersal;
  vec3 ghosts = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    if (float(i) >= u_ghosts) break;
    vec2 off = fract(v_uv + ghostVec * float(i));
    ghosts += texture(u_texture, off).rgb * u_lensColor;
  }
  vec4 orig = texture(u_original, v_uv);
  vec3 col = u_additive > 0.5 ? orig.rgb + ghosts : orig.rgb * ghosts;
  outColor = vec4(clamp(col, 0.0, 1.0), orig.a);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_bias", v.bias as number);
		setFloat(gl, l, "u_scale", v.scale as number);
		setFloat(gl, l, "u_ghosts", v.ghosts as number);
		setFloat(gl, l, "u_dispersal", v.dispersal as number);
		setFloat(gl, l, "u_additive", v.additive as number);
		setFloat(gl, l, "u_dirX", v.dirX as number);
		setFloat(gl, l, "u_dirY", v.dirY as number);
		setColor(gl, l, "u_lensColor", v.lensColor as string);
	},
};
