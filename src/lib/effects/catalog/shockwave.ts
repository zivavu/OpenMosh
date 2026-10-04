import { clockParams } from "../clock-params";
import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "shockwave",
	name: "Shockwave",
	params: [
		...clockParams(
			"Rate",
			{ min: 0.1, max: 4, step: 0.05, defaultValue: 0.5, moshMax: 2 },
			"pulse",
		),
		{
			key: "magnitude",
			label: "Magnitude",
			type: "range",
			min: 0,
			max: 0.2,
			step: 0.005,
			defaultValue: 0.08,
		},
		{
			key: "distortion",
			label: "Distortion",
			type: "range",
			min: 0,
			max: 20,
			step: 0.1,
			defaultValue: 10,
		},
		{
			key: "centerX",
			label: "Center X",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "centerY",
			label: "Center Y",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
	],
};

/** Vidvox Shockwave Pulse: a ring of displacement travelling out from the centre. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_magnitude;
uniform float u_distortion;
uniform float u_centerX;
uniform float u_centerY;
uniform vec2 u_resolution;
void main() {
  vec2 c = vec2(u_centerX, u_centerY);
  // Measured in a square space so the ring stays round on a wide frame.
  vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 rel = (v_uv - c) * asp;
  float d = length(rel);
  float t = fract(u_time) * (1.0 + d);
  vec2 uv = v_uv;
  if (d <= t + u_magnitude && d >= t - u_magnitude) {
    float diff = d - t;
    float powDiff = 1.0 - pow(abs(diff * u_distortion), 0.8);
    vec2 dir = rel / max(d, 1e-5) / asp;
    uv = v_uv + dir * diff * powDiff;
  }
  outColor = texture(u_texture, uv);
}`,
	animated: true,
	linearFilter: true,
	setUniforms: floats("magnitude", "distortion", "centerX", "centerY"),
};
