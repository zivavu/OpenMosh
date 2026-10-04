import { clockParams } from "../clock-params";
import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "rgb-burst",
	name: "RGB Burst",
	params: [
		{
			key: "amplitude",
			label: "Amplitude",
			type: "range",
			min: 0,
			max: 15,
			step: 0.1,
			defaultValue: 3,
			moshMax: 6,
		},
		{
			key: "decay",
			label: "Decay",
			type: "range",
			min: 0.05,
			max: 1,
			step: 0.01,
			defaultValue: 0.35,
		},
		...clockParams(
			"Speed",
			{ min: 0, max: 10, step: 0.1, defaultValue: 1, moshMax: 4 },
			"burst",
		),
	],
};

/** XPL GlitchRGBSplitV5: noise bursts throw each channel a different way. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amplitude;
uniform float u_decay;
// Sine-free: the burst index grows without bound.
vec4 hash4(float p) {
  vec4 p4 = fract(vec4(p) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
const int TAPS = 12;
// One burst per clock cycle: it pops at the cycle's start and decays. Green holds
// still while red and blue streak out and in from a point near the centre.
void main() {
  vec4 h = hash4(floor(u_time));
  float f = fract(u_time);
  // Decay is the share of the cycle the burst takes to fade to ~5%.
  float env = exp(-3.0 * f / u_decay) * (0.6 + 0.4 * h.x);
  vec2 center = 0.5 + (h.yz - 0.5) * 0.3;
  float a = h.w * 6.2831853;
  vec2 offset = ((v_uv - center) * 0.06 + vec2(cos(a), sin(a)) * 0.01)
              * u_amplitude * env;
  vec4 c = texture(u_texture, v_uv);
  float r = 0.0, b = 0.0;
  for (int i = 1; i <= TAPS; i++) {
    float t = float(i) / float(TAPS);
    r += texture(u_texture, v_uv - offset * t).r;
    b += texture(u_texture, v_uv + offset * t).b;
  }
  outColor = vec4(r / float(TAPS), c.g, b / float(TAPS), c.a);
}`,
	animated: true,
	linearFilter: true,
	setUniforms: floats("amplitude", "decay"),
};
