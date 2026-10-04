import { BOUNCE_GLSL, H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "smear",
	name: "Smear",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
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
			key: "trail",
			label: "Trail",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		BOUNCE_GLSL +
		`uniform float u_amount;
uniform float u_angle;
uniform float u_trail;

const int TRAIL_STEPS = 8;

vec4 at(vec2 p) {
  return texture(u_texture, vec2(bounce(p.x), bounce(p.y)));
}

void main() {
  // Each pixel is pushed by its own red/green, read as a vector, so content flows
  // with its colour. One lookup keeps the result crisp.
  float rad = u_angle * 3.14159265 / 180.0;
  float ca = cos(rad);
  float sa = sin(rad);
  vec2 push = mat2(ca, -sa, sa, ca) * (texture(u_texture, v_uv).rg - 0.5) * u_amount * 0.2;
  vec4 moved = at(v_uv + push);
  if (u_trail <= 0.0) {
    outColor = moved;
    return;
  }
  // Trail ghosts the path the pixel was pushed along.
  vec4 path = vec4(0.0);
  for (int i = 0; i < TRAIL_STEPS; i++) {
    path += at(v_uv + push * (float(i) / float(TRAIL_STEPS - 1)));
  }
  outColor = mix(moved, path / float(TRAIL_STEPS), u_trail);
}`,
	setUniforms: floats("amount", "angle", "trail"),
};
