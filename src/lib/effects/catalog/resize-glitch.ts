import { clockParams } from "../clock-params";
import { H, HASH_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "resize-glitch",
	name: "Resize Glitch",
	params: [
		{
			key: "chance",
			label: "Chance",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.3,
		},
		...clockParams(
			"Rate",
			{ min: 1, max: 60, step: 1, defaultValue: 20 },
			"roll",
		),
		{
			key: "levelX",
			label: "Level X",
			type: "range",
			min: 0.01,
			max: 10,
			step: 0.01,
			defaultValue: 2,
			moshMin: 0.5,
			moshMax: 4,
		},
		{
			key: "levelY",
			label: "Level Y",
			type: "range",
			min: 0.01,
			max: 10,
			step: 0.01,
			defaultValue: 2,
			moshMin: 0.5,
			moshMax: 4,
		},
		{
			key: "randomWidth",
			label: "Random Width",
			type: "checkbox",
			defaultValue: 1,
		},
		{
			key: "randomHeight",
			label: "Random Height",
			type: "checkbox",
			defaultValue: 1,
		},
		{
			key: "randomCenter",
			label: "Random Center",
			type: "checkbox",
			defaultValue: 1,
		},
		{
			key: "centerX",
			label: "Center X",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			visibleWhen: (v) => !v.randomCenter,
		},
		{
			key: "centerY",
			label: "Center Y",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			visibleWhen: (v) => !v.randomCenter,
		},
	],
};

/** Vidvox Resize Glitch: the frame re-scales about a point on random ticks. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		HASH_GLSL +
		`uniform float u_chance;
uniform float u_levelX;
uniform float u_levelY;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_randomWidth;
uniform float u_randomHeight;
uniform float u_randomCenter;
void main() {
  float tick = floor(u_time);
  vec2 c = u_randomCenter > 0.5
    ? vec2(hash(vec2(tick * 1.24, 0.234)), hash(vec2(tick * 2.93, 1.234)))
    : vec2(u_centerX, u_centerY);
  vec2 scale = vec2(1.0);
  if (u_chance >= 1.0 || hash(vec2(tick, 0.2321)) <= u_chance) {
    scale.x = u_randomWidth > 0.5 ? u_levelX * hash(vec2(tick + 0.315, 32.0)) : u_levelX;
    scale.y = u_randomHeight > 0.5 ? u_levelY * hash(vec2(tick + 0.942, 43.0)) : u_levelY;
  }
  vec2 loc = (v_uv - c) / max(scale, vec2(0.01)) + c;
  if (any(lessThan(loc, vec2(0.0))) || any(greaterThan(loc, vec2(1.0)))) {
    outColor = vec4(0.0);
  } else {
    outColor = texture(u_texture, loc);
  }
}`,
	animated: true,
	setUniforms: floats(
		"chance",
		"levelX",
		"levelY",
		"centerX",
		"centerY",
		"randomWidth",
		"randomHeight",
		"randomCenter",
	),
};
