import { H, HUE_ROTATE_GLSL, NOISE_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "liquid-light",
	name: "Liquid Light",
	params: [
		{
			key: "scale",
			label: "Cell Size",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.55,
		},
		{
			key: "flow",
			label: "Flow",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.4,
		},
		{
			key: "refraction",
			label: "Refraction",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			moshMin: 0.25,
		},
		{
			key: "dispersion",
			label: "Dispersion",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.45,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		NOISE_GLSL +
		HUE_ROTATE_GLSL +
		`uniform float u_scale;
uniform float u_flow;
uniform float u_refraction;
uniform float u_dispersion;
uniform float u_delta;
uniform vec2 u_resolution;
uniform sampler2D u_feedback;
void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float t = u_time * (0.04 + u_flow * 0.5);
  float freq = 1.0 + (1.0 - u_scale) * 11.0;
  vec2 p = v_uv * aspect * freq;

  // Domain warp: a slow vector field steers the cell field, so blobs creep and merge.
  vec2 w = 2.2 * vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.6));

  // Field + gradient. The offset samples reuse the same warp, so the surface normal
  // costs two extra noise lookups instead of six.
  vec2 e = (2.0 / u_resolution) * aspect * freq;
  float f = fbm(p + w);
  vec2 grad = vec2(fbm(p + w + vec2(e.x, 0.0)) - f, fbm(p + w + vec2(0.0, e.y)) - f);
  float slope = length(grad);
  vec2 n = grad / max(slope, 1e-4);

  // Refract through the cell surface, one sample per channel at different strengths.
  vec2 dir = n * min(slope * 16.0, 1.0) * u_refraction * 0.3;
  float d = u_dispersion * 0.7;
  vec3 fresh;
  fresh.r = texture(u_texture, clamp(v_uv - dir * (1.0 + d), vec2(0.0), vec2(1.0))).r;
  fresh.g = texture(u_texture, clamp(v_uv - dir, vec2(0.0), vec2(1.0))).g;
  fresh.b = texture(u_texture, clamp(v_uv - dir * (1.0 - d), vec2(0.0), vec2(1.0))).b;
  float freshA = max(texture(u_texture, clamp(v_uv - dir * (1.0 + d), vec2(0.0), vec2(1.0))).a,
                     texture(u_texture, clamp(v_uv - dir * (1.0 - d), vec2(0.0), vec2(1.0))).a);

  // Thin-film iridescence riding the field value, strongest on the rims.
  float rim = min(slope * 24.0, 1.0);
  fresh = mix(fresh, hueRotate(fresh, f * 220.0 + t * 40.0), rim * u_dispersion);

  // Dye drifts along the field (perpendicular to the gradient) and heals back to
  // the live input, so the wash never buries the source.
  vec2 from = clamp(v_uv - vec2(-n.y, n.x) * u_delta * u_flow * 0.05, vec2(0.0), vec2(1.0));
  vec4 prevS = texture(u_feedback, from);
  float heal = 1.0 - exp(-mix(6.0, 1.2, u_flow) * u_delta);
  outColor = vec4(clamp(mix(prevS.rgb, fresh, heal), 0.0, 1.0),
                  clamp(mix(prevS.a, freshA, heal), 0.0, 1.0));
}`,
	animated: true,
	linearFilter: true,
	setUniforms: floats("scale", "flow", "refraction", "dispersion"),
};
