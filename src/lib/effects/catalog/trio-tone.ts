import { H, setColor, setFloat } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "trio-tone",
	name: "Trio Tone",
	params: [
		{
			key: "darkColor",
			label: "Dark",
			type: "color",
			defaultValue: "#002aff",
		},
		{
			key: "midColor",
			label: "Mid",
			type: "color",
			defaultValue: "#00ff00",
		},
		{
			key: "brightColor",
			label: "Bright",
			type: "color",
			defaultValue: "#ff0000",
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

/** Vidvox Trio Tone: three-stop luminance ramp, black at the bottom. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform vec3 u_darkColor;
uniform vec3 u_midColor;
uniform vec3 u_brightColor;
uniform float u_intensity;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 lo = vec3(0.0);
  vec3 hi = u_darkColor;
  float ix = 0.0;
  if (lum > 0.66) {
    lo = u_midColor;
    hi = u_brightColor;
    ix = 2.0;
  } else if (lum > 0.33) {
    lo = u_darkColor;
    hi = u_midColor;
    ix = 1.0;
  }
  vec3 tone = mix(lo, hi, clamp((lum - ix * 0.33) / 0.33, 0.0, 1.0));
  outColor = vec4(mix(c.rgb, tone, u_intensity), c.a);
}`,
	setUniforms: (gl, l, v) => {
		setColor(gl, l, "u_darkColor", v.darkColor as string);
		setColor(gl, l, "u_midColor", v.midColor as string);
		setColor(gl, l, "u_brightColor", v.brightColor as string);
		setFloat(gl, l, "u_intensity", v.intensity as number);
	},
};
