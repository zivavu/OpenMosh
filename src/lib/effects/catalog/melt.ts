import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "melt",
	name: "Melt",
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
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0.1,
			max: 5,
			step: 0.1,
			defaultValue: 1,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_delta;
uniform sampler2D u_feedback;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 5.0) * 0.3
       + vnoise(p * 4.41 + 9.0) * 0.15;
}
void main() {
  vec3 lum = vec3(0.299, 0.587, 0.114);
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = u_time;

  // Broad slow columns crossed with fine streaks; wanders gently over time.
  float cols = fbm(vec2(v_uv.x * 4.0, t * 0.05));
  float streaks = fbm(vec2(v_uv.x * 47.0 + 13.0, t * 0.021));
  float drip = cols * cols * (0.3 + 0.7 * streaks);

  // A melting front descends per column, so drips grow downward over time.
  float front = t * u_amount * (0.02 + 0.3 * cols);
  float meltOn = smoothstep(0.0, 0.18, front - v_uv.y);

  // Bright wax runs faster.
  float bright = dot(texture(u_feedback, v_uv).rgb, lum);

  // Per-frame fall distance (uv units), framerate-independent via u_delta.
  float fall = u_delta * u_amount * meltOn
             * (0.05 + 1.6 * drip) * (0.35 + 0.65 * bright) * 0.06;

  // Moving drips swing sideways; amplitude scales with their speed.
  float sway = sin(v_uv.y * 21.0 - t * 1.4 + cols * 6.2831) * fall * 2.2;

  // Advection: this pixel receives what was slightly above it last frame (v_uv.y is screen-down).
  vec2 from = vec2(clamp(v_uv.x + sway, 0.0, 1.0),
                   clamp(v_uv.y - fall, 0.0, 1.0));
  vec4 meltedS = texture(u_feedback, from);
  vec3 melted = meltedS.rgb;
  float meltedA = meltedS.a;

  // Only where actually flowing: fast drips smear like wax, untouched areas stay crisp.
  float visc = 0.7 * clamp(fall / (px.y * 1.5), 0.0, 1.0);
  vec3 up   = texture(u_feedback, clamp(from + vec2(0.0, px.y * 1.5), vec2(0.0), vec2(1.0))).rgb;
  vec3 down = texture(u_feedback, clamp(from - vec2(0.0, px.y * 1.5), vec2(0.0), vec2(1.0))).rgb;
  melted = mix(melted, (melted * 2.0 + up + down) * 0.25, visc);

  // The source image seeps back through the wax, so the melt reaches equilibrium
  // instead of burying the input. Higher amounts drip faster and set slower.
  vec4 freshS = texture(u_texture, v_uv);
  vec3 fresh = freshS.rgb;
  float heal = 1.0 - exp(-mix(2.0, 0.25, u_amount) * u_delta);
  melted = mix(melted, fresh, heal);
  meltedA = mix(meltedA, freshS.a, heal);

  // Where the front hasn't arrived yet, show the live chain input so unmelted regions stay alive.
  vec3 col = mix(fresh, melted, meltOn);

  outColor = vec4(clamp(col, 0.0, 1.0), mix(freshS.a, meltedA, meltOn));
}`,
	animated: true,
	setUniforms: floats("amount"),
};
