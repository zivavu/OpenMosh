import { BOUNCE_GLSL, H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "mirror",
	name: "Mirror",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
			// A partial mirror reads as a blurry seam, so a roll is only worth
			// it at full strength.
			moshMin: 1,
			moshMax: 1,
		},
		{
			key: "side",
			label: "Side",
			type: "range",
			min: 0,
			max: 3,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "position",
			label: "Position",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		BOUNCE_GLSL +
		`uniform float u_amount;
uniform int u_side;
uniform float u_position;
void main() {
  vec2 uv = v_uv;
  if (u_side == 0 && uv.x > u_position) uv.x = bounce(2.0 * u_position - uv.x);
  else if (u_side == 1 && uv.x < u_position) uv.x = bounce(2.0 * u_position - uv.x);
  else if (u_side == 2 && uv.y > u_position) uv.y = bounce(2.0 * u_position - uv.y);
  else if (u_side == 3 && uv.y < u_position) uv.y = bounce(2.0 * u_position - uv.y);
  outColor = mix(texture(u_texture, v_uv), texture(u_texture, uv), u_amount);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_amount", v.amount as number);
		setInt(gl, l, "u_side", v.side as number);
		setFloat(gl, l, "u_position", v.position as number);
	},
};
