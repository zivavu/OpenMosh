import { H, floats } from "../../gl/shader-lib";
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
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 180,
			step: 1,
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_count;
uniform float u_offset;
uniform float u_angle;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 size = vec2(textureSize(u_texture, 0));
  float rad = radians(u_angle);
  vec2 along = vec2(cos(rad), sin(rad));
  vec2 across = vec2(-along.y, along.x);
  vec2 p = (v_uv - 0.5) * size;
  float span = dot(abs(across), size);
  float slice = floor((dot(p, across) / span + 0.5) * u_count);
  vec2 uv = v_uv + along * (hash(slice) - 0.5) * u_offset / size;
  outColor = texture(u_texture, uv);
}`,
	setUniforms: floats("count", "offset", "angle"),
};
