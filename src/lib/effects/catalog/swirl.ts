import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "swirl",
	name: "Swirl",
	params: [
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 720,
			step: 1,
			defaultValue: 180,
		},
		{
			key: "radius",
			label: "Radius",
			type: "range",
			min: 0.1,
			max: 1.5,
			step: 0.01,
			defaultValue: 0.75,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0,
			max: 5,
			step: 0.1,
			defaultValue: 0.5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_angle;
uniform float u_radius;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  float aspect = res.x / res.y;
  vec2 c = v_uv - 0.5;
  c.x *= aspect;
  float d = length(c);
  // Whirlpool profile: full twist at the core, quadratic falloff to zero at u_radius.
  float infl = 1.0 - smoothstep(0.0, u_radius, d);
  infl *= infl;
  // Bounded rocking around the base twist instead of endless wind-up, so the vortex breathes.
  float a = (u_angle + sin(u_time * 0.8) * 60.0) * (3.14159265 / 180.0) * infl;
  float ca = cos(a), sa = sin(a);
  vec2 r = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  vec2 uv = vec2(r.x / aspect, r.y) + 0.5;
  outColor = texture(u_texture, uv);
}`,
	animated: true,
	linearFilter: true,
	setUniforms: floats("angle", "radius"),
};
