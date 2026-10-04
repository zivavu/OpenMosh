import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "halftone",
	name: "Halftone",
	// Curated rolls leave it out: it only fits when picked on purpose.
	moshable: false,
	params: [
		{
			key: "scale",
			label: "Size",
			type: "range",
			min: 2,
			max: 40,
			step: 0.5,
			defaultValue: 8,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 90,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "sharpness",
			label: "Sharpness",
			type: "range",
			min: 2,
			max: 30,
			step: 0.5,
			defaultValue: 10,
		},
		{ key: "color", label: "Color", type: "checkbox", defaultValue: 1 },
	],
};

/** A sine dot screen added to the tone, then pushed hard: light areas keep dark
 * dots, dark areas bright ones, and midtones turn into a checkerboard. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_scale;
uniform float u_angle;
uniform float u_sharpness;
uniform float u_color;
void main() {
  vec4 src = texture(u_texture, v_uv);
  vec2 pos = v_uv * vec2(textureSize(u_texture, 0));
  float a = radians(u_angle);
  vec2 rp = mat2(cos(a), sin(a), -sin(a), cos(a)) * pos * (3.14159265 / u_scale);
  float dots = sin(rp.x) * sin(rp.y) * 0.4;
  vec3 tone = mix(vec3(dot(src.rgb, vec3(0.2126, 0.7152, 0.0722))), src.rgb, u_color);
  outColor = vec4(clamp((tone - 0.5 + dots) * u_sharpness + 0.5, 0.0, 1.0), src.a);
}`,
	setUniforms: floats("scale", "angle", "sharpness", "color"),
};
