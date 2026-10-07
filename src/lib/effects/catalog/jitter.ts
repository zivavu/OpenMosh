import { H, NOISE_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "jitter",
	name: "Jitter",
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
		NOISE_GLSL +
		`uniform float u_amount;
float tri(vec2 s) { return hash(s) + hash(s + 19.1) - 1.0; }
void main() {
  vec2 size = vec2(textureSize(u_texture, 0));
  vec2 pix = v_uv * size;
  float beat = floor(u_time * 12.0);
  // Each beat rolls its own zone scale, patch size and axis balance.
  float zoneScale = mix(1.5, 7.0, hash(vec2(beat, 11.0)));
  float patchSize = mix(12.0, 72.0, hash(vec2(beat, 12.0)));
  float lean = hash(vec2(beat, 13.0));
  float zoneY = smoothstep(0.3, 0.9, vnoise(vec2(v_uv.y * zoneScale, beat * 0.37)));
  float zoneX = smoothstep(0.3, 0.9, vnoise(vec2(v_uv.x * zoneScale, beat * 0.37 + 40.0)));
  // Patches re-roll on their own clocks, so the picture never updates in lockstep.
  vec2 cell = floor(pix / patchSize);
  float rowBeat = floor(u_time * mix(6.0, 20.0, hash(vec2(cell.y, 7.0))) + hash(vec2(cell.y, 8.0)));
  float colBeat = floor(u_time * mix(6.0, 20.0, hash(vec2(cell.x, 9.0))) + hash(vec2(cell.x, 10.0)));
  float row = floor(pix.y / mix(1.0, 5.0, hash(vec2(cell.y, rowBeat))));
  float col = floor(pix.x / mix(1.0, 5.0, hash(vec2(cell.x, colBeat + 5.0))));
  // A rare row or column jumps much further than the rest.
  float rowKick = 1.0 + 2.5 * step(0.97, hash(vec2(row, rowBeat + 3.0)));
  float colKick = 1.0 + 2.5 * step(0.97, hash(vec2(col, colBeat + 4.0)));
  vec2 jit = vec2(
    tri(vec2(row, rowBeat)) * (0.15 + zoneY) * rowKick * mix(0.4, 1.3, lean),
    tri(vec2(col, colBeat + 2.0)) * (0.15 + zoneX) * colKick * mix(0.9, 0.2, lean)
  ) * u_amount * 0.5 / size;
  // Channels jitter by different amounts: a colour shimmer on edges.
  vec4 c = texture(u_texture, v_uv + jit);
  c.r = texture(u_texture, v_uv + jit * 1.3).r;
  c.b = texture(u_texture, v_uv + jit * 0.7).b;
  outColor = c;
}`,
	animated: true,
	setUniforms: floats("amount"),
};
