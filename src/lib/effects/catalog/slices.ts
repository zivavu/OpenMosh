import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "slices",
	name: "Slices",
	params: [
		{
			key: "count",
			label: "Count",
			type: "range",
			min: 1,
			max: 50,
			step: 1,
			defaultValue: 10,
		},
		{
			key: "offset",
			label: "Offset",
			type: "range",
			min: 0,
			max: 100,
			step: 1,
			defaultValue: 20,
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
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_count;
uniform float u_offset;
uniform int u_direction;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = v_uv;
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  if (u_direction == 0) {
    float slice = floor(uv.y * u_count);
    uv.x += (hash(slice) - 0.5) * u_offset * px.x;
  } else {
    float slice = floor(uv.x * u_count);
    uv.y += (hash(slice) - 0.5) * u_offset * px.y;
  }
  outColor = texture(u_texture, uv);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_count", v.count as number);
		setFloat(gl, l, "u_offset", v.offset as number);
		setInt(gl, l, "u_direction", v.direction === "vertical" ? 1 : 0);
	},
};
