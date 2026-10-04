import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "circle-warp",
	name: "Circle Warp",
	// Curated rolls leave it out: it only fits when picked on purpose.
	moshable: false,
	params: [
		{
			key: "radius",
			label: "Radius",
			type: "range",
			min: 0.05,
			max: 0.5,
			step: 0.005,
			defaultValue: 0.5,
			moshMin: 0.25,
		},
		{
			key: "width",
			label: "Width",
			type: "range",
			min: 0.1,
			max: 2,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "rotation",
			label: "Rotation",
			type: "range",
			min: 0,
			max: 1,
			step: 0.005,
			defaultValue: 0,
		},
	],
};

/** Vidvox Circle Warp: the frame's height is fitted into a circle. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_radius;
uniform float u_width;
uniform float u_rotation;
uniform vec2 u_resolution;
void main() {
  vec2 ct = vec2(0.5);
  vec2 pt = v_uv;
  pt.x = (pt.x - 0.5) / u_width + 0.5;
  // Square coordinates: the shorter side spans [0,1], the longer is centred.
  vec2 r = u_resolution;
  pt = r.x >= r.y
    ? vec2((pt.x * r.x - r.x * 0.5 + r.y * 0.5) / r.y, pt.y)
    : vec2(pt.x, (pt.y * r.y - r.y * 0.5 + r.x * 0.5) / r.x);
  float a = u_rotation * 6.28318530718;
  vec2 d = pt - ct;
  pt = vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a)) + ct;
  if (distance(pt, ct) >= u_radius) {
    outColor = vec4(0.0);
    return;
  }
  float chord = 2.0 * sqrt(max(u_radius * u_radius - (pt.x - 0.5) * (pt.x - 0.5), 1e-6));
  pt.y = (pt.y - 0.5) / chord + 0.5;
  outColor = texture(u_texture, pt);
}`,
	linearFilter: true,
	setUniforms: floats("radius", "width", "rotation"),
};
