import { H, HASH_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "pixel-shifter",
	name: "Pixel Shifter",
	params: [
		{
			key: "hFrequency",
			label: "H Frequency",
			type: "range",
			min: -16,
			max: 16,
			step: 0.1,
			defaultValue: 1,
			moshMin: -4,
			moshMax: 4,
		},
		{
			key: "hPhase",
			label: "H Phase",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "hRandom",
			label: "H Random",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
			moshMax: 0.3,
		},
		{
			key: "vFrequency",
			label: "V Frequency",
			type: "range",
			min: -16,
			max: 16,
			step: 0.1,
			defaultValue: 0,
			moshMin: -4,
			moshMax: 4,
		},
		{
			key: "vPhase",
			label: "V Phase",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "vRandom",
			label: "V Random",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
			moshMax: 0.3,
		},
		{
			key: "sinusoidal",
			label: "Sinusoidal",
			type: "checkbox",
			defaultValue: 1,
		},
		{ key: "mirror", label: "Mirror", type: "checkbox", defaultValue: 1 },
	],
};

/** Vidvox Pixel Shifter: rows and columns slide by a wave of the other axis. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		HASH_GLSL +
		`uniform float u_hPhase;
uniform float u_hFrequency;
uniform float u_hRandom;
uniform float u_vPhase;
uniform float u_vFrequency;
uniform float u_vRandom;
uniform float u_sinusoidal;
uniform float u_mirror;
const float PI = 3.14159265359;
void main() {
  vec2 loc = v_uv;
  float modVal = u_mirror > 0.5 ? 2.0 : 1.0;
  // Column shift depends on the row; the row shift then uses the shifted column.
  if (u_sinusoidal > 0.5) {
    loc.x = mod(u_hRandom * hash(vec2(u_time * 0.127, loc.x)) + loc.x
      + sign(u_hFrequency) * 0.5 * (1.0 + cos(2.0 * PI * (u_hPhase + u_hFrequency * loc.y))), modVal);
  } else {
    loc.x = mod(u_hRandom * hash(vec2(u_time * 0.129, loc.x)) + loc.x
      + u_hFrequency * loc.y + u_hPhase, modVal);
  }
  if (u_sinusoidal > 0.5) {
    loc.y = mod(u_vRandom * hash(vec2(u_time * 0.273, loc.y)) + loc.y
      + sign(u_vFrequency) * 0.5 * (1.0 + cos(2.0 * PI * (u_vPhase + u_vFrequency * loc.x))), modVal);
  } else {
    loc.y = mod(u_vRandom * hash(vec2(u_time * 0.341, loc.y)) + loc.y
      + u_vFrequency * loc.x + u_vPhase, modVal);
  }
  if (loc.x > 1.0) loc.x = 2.0 - loc.x;
  if (loc.y > 1.0) loc.y = 2.0 - loc.y;
  outColor = texture(u_texture, loc);
}`,
	animated: true,
	setUniforms: floats(
		"hPhase",
		"hFrequency",
		"hRandom",
		"vPhase",
		"vFrequency",
		"vRandom",
		"sinusoidal",
		"mirror",
	),
};
