import { H, HUE_ROTATE_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "color-correction",
	name: "Color Correction",
	params: [
		{
			key: "brightness",
			label: "Brightness",
			type: "range",
			min: -1,
			max: 1,
			step: 0.01,
			defaultValue: 0,
			moshMin: -0.5,
		},
		{
			key: "contrast",
			label: "Contrast",
			type: "range",
			min: -1,
			max: 1,
			step: 0.01,
			moshMin: -0.5,
			moshMax: 0.5,
			defaultValue: 0,
		},
		{
			key: "hue",
			label: "Hue",
			type: "range",
			min: -180,
			max: 180,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "saturation",
			label: "Saturation",
			type: "range",
			min: -1,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		HUE_ROTATE_GLSL +
		`uniform float u_brightness;
uniform float u_contrast;
uniform float u_hue;
uniform float u_saturation;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 rgb = c.rgb * pow(2.0, u_brightness * 2.0);
  float ct = u_contrast < 0.0 ? 1.0 + u_contrast : 1.0 + u_contrast * u_contrast * 10.0;
  rgb = (rgb - 0.5) * ct + 0.5;
  rgb = hueRotate(rgb, u_hue);
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(luma), rgb, 1.0 + u_saturation);
  outColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`,
	setUniforms: floats("brightness", "contrast", "hue", "saturation"),
};
