import { H, HASH_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "petri",
	name: "Petri",
	// Curated rolls leave it out: it only fits when picked on purpose.
	moshable: false,
	params: [
		{
			key: "reaction",
			label: "Reaction",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "drift",
			label: "Drift",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.72,
		},
		{
			key: "scale",
			label: "Pattern Size",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.3,
		},
		{
			key: "takeover",
			label: "Takeover",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.45,
			moshMax: 0.8,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		HASH_GLSL +
		`uniform float u_reaction;
uniform float u_drift;
uniform float u_scale;
uniform float u_takeover;
uniform float u_delta;
uniform vec2 u_resolution;
uniform sampler2D u_feedback;
void main() {
  // Three reagents held in RGB, so the simulation state is the visible image. Each
  // cell reacts against the local average of its neighbours, which rolls the waves outward.
  vec2 px = (1.0 + u_scale * 3.0) / u_resolution;
  vec3 avg = vec3(0.0);
  float avgA = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = clamp(v_uv + vec2(float(x), float(y)) * px, vec2(0.0), vec2(1.0));
      avg += texture(u_feedback, uv).rgb;
      avgA += texture(u_feedback, uv).a;
    }
  }
  avg /= 9.0;
  avgA /= 9.0;

  // Each reagent drifts along its own heading, 120 degrees apart and slowly rotating,
  // so they chase one another across the frame. Pure transport, so it can't tint anything.
  float curl = (u_drift - 0.5) * 2.0;
  float a = u_time * 0.15;
  float reach = 2.5 * curl;
  vec3 drift;
  drift.r = texture(u_feedback, clamp(v_uv + vec2(cos(a), sin(a)) * px * reach, vec2(0.0), vec2(1.0))).r;
  drift.g = texture(u_feedback, clamp(v_uv + vec2(cos(a + 2.0944), sin(a + 2.0944)) * px * reach, vec2(0.0), vec2(1.0))).g;
  drift.b = texture(u_feedback, clamp(v_uv + vec2(cos(a + 4.1888), sin(a + 4.1888)) * px * reach, vec2(0.0), vec2(1.0))).b;
  avg = mix(avg, drift, 0.6 * abs(curl));

  // Cyclic reaction: red eats green eats blue eats red. The three increments sum to
  // exactly zero, so total concentration is conserved and no reagent can win globally.
  float k = clamp(u_delta * 60.0, 0.4, 2.0) * (0.4 + u_reaction * 1.6);
  vec3 next;
  next.r = avg.r + avg.r * (avg.g - avg.b) * k;
  next.g = avg.g + avg.g * (avg.b - avg.r) * k;
  next.b = avg.b + avg.b * (avg.r - avg.g) * k;

  // A whisper of noise nucleates the spirals and keeps flat regions from locking up.
  next += (hash(v_uv * u_resolution + fract(u_time)) - 0.5) * 0.004;
  next = clamp(next, 0.0, 1.0);

  // The picture is fed back in as reagent concentration, so the chemistry grows out
  // of the image's own colours. Low takeover heals fast, high lets the reaction run away.
  vec4 srcS = texture(u_texture, v_uv);
  vec3 src = srcS.rgb;
  float seed = 1.0 - exp(-mix(7.0, 0.22, u_takeover) * u_delta);
  outColor = vec4(clamp(mix(next, src, seed), 0.0, 1.0),
                  clamp(mix(avgA, srcS.a, seed), 0.0, 1.0));
}`,
	animated: true,
	hdrFeedback: true,
	setUniforms: floats("reaction", "drift", "scale", "takeover"),
};
