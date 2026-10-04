import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "wobble",
	name: "Wobble",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 100,
			step: 1,
			defaultValue: 20,
		},
		{
			key: "frequency",
			label: "Frequency",
			type: "range",
			min: 1,
			max: 5,
			step: 0.1,
			defaultValue: 3,
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
uniform float u_frequency;
uniform float u_speed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
// Fractal Brownian motion, 3 octaves
float fbm(vec2 p) {
  float v = 0.0;
  v += 0.5    * noise(p); p *= 2.13;
  v += 0.25   * noise(p); p *= 2.07;
  v += 0.125  * noise(p);
  return v / 0.875;
}

void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = u_time * u_speed;
  vec2 st = v_uv * u_frequency;

  // 2D noise-based displacement, varies in both axes
  float ox = fbm(st + vec2(t * 0.7, t * 0.3)) - 0.5;
  float oy = fbm(st + vec2(t * -0.4, t * 0.8) + 50.0) - 0.5;

  vec2 off = vec2(ox, oy) * 2.0 * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
	animated: true,
	setUniforms: floats("amount", "frequency", "speed"),
};
