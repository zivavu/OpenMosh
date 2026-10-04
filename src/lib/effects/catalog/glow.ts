import { GLOW_VBLUR_FRAG, H, floats } from "../../gl/shader-lib";
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
			defaultValue: 0.3,
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
			fragment:
				H +
				`uniform float u_cutoff;
uniform float u_radius;
uniform vec2 u_resolution;
void main() {
  vec2 px = 1.0 / u_resolution;
  float spread = u_radius * 3.0;
  float sigma = spread * 0.4;
  float invSigma2 = 1.0 / max(sigma * sigma, 0.001);
  vec3 bloom = vec3(0.0);
  float totalW = 0.0;
  const int R = 16;
  float step = spread / float(R);
  for (int i = -R; i <= R; i++) {
    float fi = float(i) * step;
    float w = exp(-fi * fi * invSigma2);
    vec2 off = vec2(fi * px.x, 0.0);
    // Weighted by coverage, so a half-erased edge blooms half as much.
    vec4 s4 = texture(u_texture, v_uv + off);
    vec3 s = s4.rgb * s4.a;
    float luma = dot(s, vec3(0.299, 0.587, 0.114));
    float contrib = max(0.0, luma - u_cutoff);
    bloom += s * contrib * contrib * w;
    totalW += w;
  }
  bloom /= totalW;
  outColor = vec4(bloom, 1.0);
}`,
			linearFilter: true,
		},
		{
			fragment: H + GLOW_VBLUR_FRAG,
			linearFilter: true,
		},
	],
	fragment:
		H +
		`uniform float u_amount;
uniform sampler2D u_original;
void main() {
  vec4 orig = texture(u_original, v_uv);
  vec3 bloom = texture(u_texture, v_uv).rgb * u_amount;
  // The halo carries its own coverage, so glow spreads past the edge of a text
  // layer or a cut-out. Summed premultiplied and divided back out, or it scales twice.
  float halo = dot(bloom, vec3(0.299, 0.587, 0.114));
  float a = clamp(max(orig.a, halo), 0.0, 1.0);
  vec3 lit = orig.rgb * orig.a + bloom;
  outColor = vec4(a > 0.0 ? lit / a : vec3(0.0), a);
}`,
	setUniforms: floats("amount", "cutoff", "radius"),
};
