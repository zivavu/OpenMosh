import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "pixel-sort",
	name: "Pixel Sort",
	params: [
		{
			key: "threshold",
			label: "Threshold",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "ceiling",
			label: "Ceiling",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "range",
			label: "Range",
			type: "range",
			min: 0,
			max: 200,
			step: 1,
			defaultValue: 80,
		},
		{
			key: "direction",
			label: "Direction",
			type: "select",
			defaultValue: "horizontal",
			options: [
				{ label: "Horizontal", value: "horizontal" },
				{ label: "Vertical", value: "vertical" },
			],
		},
		{ key: "reverse", label: "Reverse", type: "checkbox", defaultValue: 0 },
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_threshold;
uniform float u_ceiling;
uniform float u_range;
uniform int u_direction;
uniform float u_reverse;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float lo = min(u_threshold, u_ceiling);
  float hi = max(u_threshold, u_ceiling);
  float span = hi - lo;
  float norm = span > 0.001 ? (clamp(luma, lo, hi) - lo) / span : 0.0;
  float sign = (u_reverse > 0.5) ? -1.0 : 1.0;
  float disp = norm * u_range * sign;
  vec2 offset = u_direction == 0 ? vec2(disp * px.x, 0.0) : vec2(0.0, disp * px.y);
  outColor = texture(u_texture, v_uv + offset);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_threshold", v.threshold as number);
		setFloat(gl, l, "u_ceiling", v.ceiling as number);
		setFloat(gl, l, "u_range", v.range as number);
		setInt(gl, l, "u_direction", v.direction === "vertical" ? 1 : 0);
		setFloat(gl, l, "u_reverse", v.reverse as number);
	},
};
