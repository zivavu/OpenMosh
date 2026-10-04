import { H, HSV_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "solarize",
	name: "Solarize",
	params: [
		{
			key: "pivot",
			label: "Pivot",
			type: "range",
			min: 0.1,
			max: 0.9,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "curve",
			label: "Curve",
			type: "range",
			min: 0.5,
			max: 4,
			step: 0.05,
			defaultValue: 2,
		},
		{
			key: "colorize",
			label: "Colorize",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.1,
			// The classic look sits near the bottom; moshing to 0.8 makes a
			// hue-shifted negative.
			moshMax: 0.4,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		HSV_GLSL +
		`uniform float u_pivot;
uniform float u_curve;
uniform float u_colorize;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);

  // The Sabattier fold: gamma the value channel, then reflect it about the pivot.
  // Below the pivot inverts, above climbs from black, the pivot lands on zero.
  float v = pow(hsv.z, u_curve);
  float folded = v < u_pivot
    ? 1.0 - v / max(u_pivot, 1e-4)
    : (v - u_pivot) / max(u_pivot, 1e-4);

  // Saturation follows how bright the pixel was, not what the fold turned it into,
  // so the surviving colour tracks the original. A darkroom solarization is near-monochrome.
  float sat = hsv.y * hsv.z * u_colorize;

  outColor = vec4(clamp(hsv2rgb(vec3(hsv.x, sat, folded)), 0.0, 1.0), c.a);
}`,
	setUniforms: floats("pivot", "curve", "colorize"),
};
