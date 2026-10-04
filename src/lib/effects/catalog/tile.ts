import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "tile",
	name: "Tile",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "size",
			label: "Size",
			type: "range",
			min: 1,
			max: 10,
			step: 0.1,
			defaultValue: 2,
		},
		{
			key: "offset",
			label: "Offset",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.3,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 360,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0,
			max: 50,
			step: 0.1,
			defaultValue: 0,
			moshMax: 20,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_size;
uniform float u_offset;
uniform float u_angle;
uniform vec2 u_resolution;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float rad = radians(u_angle);
  float c = cos(rad), s = sin(rad);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  vec2 copy = vec2(aspect, 1.0) / u_size;
  // Copies overlap at Offset 0, sit edge to edge near 0.9 and leave a small gap at 1.
  vec2 spacing = copy * (0.25 + u_offset * 0.85);
  // Speed flows every copy the same way along the rows.
  q.x += u_time * 0.2 * spacing.x;
  vec2 k = floor(q / spacing + 0.5);
  // Each spot shows the nearest copy; mirroring odd ones makes overlaps seamless.
  vec2 local = (q - k * spacing) / copy * (1.0 - 2.0 * mod(k, 2.0)) + 0.5;
  bool inside = all(greaterThanEqual(local, vec2(0.0))) && all(lessThanEqual(local, vec2(1.0)));
  vec4 tiled = inside ? texture(u_texture, local) : vec4(0.0);
  outColor = mix(texture(u_texture, v_uv), tiled, u_amount);
}`,
	animated: true,
	setUniforms: floats("amount", "size", "offset", "angle"),
};
