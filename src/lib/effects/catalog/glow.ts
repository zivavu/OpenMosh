import { H, UPSAMPLE_TENT_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "glow",
	name: "Glow",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 50,
			step: 0.01,
			defaultValue: 4,
		},
		{
			key: "cutoff",
			label: "Cutoff",
			type: "range",
			min: 0,
			max: 0.7,
			step: 0.01,
			defaultValue: 0.4,
		},
		{
			key: "radius",
			label: "Radius",
			type: "range",
			min: 1,
			max: 10,
			step: 0.5,
			defaultValue: 8,
		},
	],
};

export const shader: EffectShaderDef = {
	prePasses: [
		{
			// Bright pass. Keyed mostly on the brightest channel, not luma, so saturated
			// colours glow in their own hue instead of dropping out.
			fragment:
				H +
				`uniform float u_cutoff;
void main() {
  // Weighted by coverage, so a half-erased edge blooms half as much.
  vec4 s4 = texture(u_texture, v_uv);
  vec3 c = s4.rgb * s4.a;
  float peak = max(c.r, max(c.g, c.b));
  float key = mix(dot(c, vec3(0.299, 0.587, 0.114)), peak, 0.8);
  // Squared, so highlights lead and midtones only tint the glow.
  // A higher cutoff lets more of the image glow.
  float threshold = 0.7 - u_cutoff;
  float over = clamp((key - threshold) / (1.0 - threshold), 0.0, 1.0);
  float w = over * over / max(peak, 1e-4);
  outColor = vec4(c * w, 1.0);
}`,
			linearFilter: true,
		},
		{
			// Radius sets how much of each wider level reaches the result: a tight
			// halo at 1, a haze across the frame at 10.
			fragment:
				H +
				UPSAMPLE_TENT_GLSL +
				`uniform sampler2D u_level;
uniform vec2 u_texel;
uniform float u_radius;
void main() {
  float spread = mix(0.2, 0.75, (u_radius - 1.0) / 9.0);
  vec3 wide = upsampleTent(u_texture, v_uv, u_texel);
  vec3 tight = texture(u_level, v_uv).rgb;
  outColor = vec4(mix(tight, wide, spread), 1.0);
}`,
			pyramid: true,
		},
	],
	fragment:
		H +
		`uniform float u_amount;
uniform sampler2D u_original;
void main() {
  vec4 orig = texture(u_original, v_uv);
  vec3 bloom = texture(u_texture, v_uv).rgb * u_amount * 0.5;
  // Saturated, or the halo washes out toward white where colours overlap.
  float bloomLuma = dot(bloom, vec3(0.299, 0.587, 0.114));
  bloom = max(mix(vec3(bloomLuma), bloom, 2.0), 0.0);
  vec3 lit = orig.rgb * orig.a + bloom;
  // The halo carries its own coverage, so glow spreads past the edge of a text
  // layer or a cut-out. Summed premultiplied and divided back out, or it scales twice.
  float halo = dot(bloom, vec3(0.299, 0.587, 0.114));
  float a = clamp(max(orig.a, halo), 0.0, 1.0);
  outColor = vec4(a > 0.0 ? lit / a : vec3(0.0), a);
}`,
	setUniforms: floats("amount", "cutoff", "radius"),
};
