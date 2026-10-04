import {
	H,
	HUE_ROTATE_GLSL,
	NOISE_GLSL,
	setFloat,
	setInt,
} from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "feedback",
	name: "Feedback",
	params: [
		{
			key: "decay",
			label: "Decay",
			type: "range",
			// Never quite 0: with no decay the loop never releases a frame and
			// welds to the brightest.
			min: 0.02,
			max: 1,
			step: 0.01,
			defaultValue: 0.45,
		},
		{
			key: "scale",
			label: "Scale",
			type: "range",
			min: -1,
			max: 1,
			step: 0.01,
			defaultValue: 0.12,
		},
		{
			key: "rotate",
			label: "Rotate",
			type: "range",
			min: -90,
			max: 90,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "warp",
			label: "Warp",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "hue",
			label: "Hue Shift",
			type: "range",
			min: -180,
			max: 180,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "blend",
			label: "Blend",
			type: "select",
			defaultValue: "max",
			options: [
				{ label: "Max", value: "max" },
				{ label: "Screen", value: "screen" },
				{ label: "Add", value: "add" },
			],
			// Screen and add compound the loop toward white; max is the only one
			// that survives a random decay.
			moshOptions: ["max"],
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		NOISE_GLSL +
		HUE_ROTATE_GLSL +
		`uniform float u_decay;
uniform float u_scale;
uniform float u_rotate;
uniform float u_warp;
uniform float u_hue;
uniform int u_blend;
uniform float u_delta;
uniform sampler2D u_feedback;
void main() {
  // Every transform is per second and scaled by the frame delta, so a trail decays
  // and travels the same distance at any frame rate.
  float s = 1.0 - u_scale * u_delta;
  float a = u_rotate * (3.14159265 / 180.0) * u_delta;
  float ca = cos(a), sa = sin(a);
  vec2 c = v_uv - 0.5;
  vec2 from = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) * s + 0.5;

  // Noise drift, so the trail curls away instead of sliding rigidly along the scale/rotate path.
  if (u_warp > 0.0) {
    float nx = fbm(v_uv * 3.0 + u_time * 0.15);
    float ny = fbm(v_uv * 3.0 - u_time * 0.12 + 17.0);
    from += (vec2(nx, ny) - 0.5) * u_warp * 0.5 * u_delta;
  }

  vec4 prev = texture(u_feedback, clamp(from, 0.0, 1.0));
  // The hue shift compounds, so old ghosts separate in colour from new ones rather
  // than stacking into one grey smear.
  if (u_hue != 0.0) prev.rgb = hueRotate(prev.rgb, u_hue * u_delta);
  prev *= pow(1.0 - u_decay * 0.06, u_delta * 60.0);

  vec4 fresh = texture(u_texture, v_uv);
  vec3 col = u_blend == 1
      ? 1.0 - (1.0 - fresh.rgb) * (1.0 - prev.rgb)
      : u_blend == 2 ? fresh.rgb + prev.rgb : max(fresh.rgb, prev.rgb);
  outColor = vec4(clamp(col, 0.0, 1.0), clamp(max(fresh.a, prev.a), 0.0, 1.0));
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_decay", v.decay as number);
		setFloat(gl, l, "u_scale", v.scale as number);
		setFloat(gl, l, "u_rotate", v.rotate as number);
		setFloat(gl, l, "u_warp", v.warp as number);
		setFloat(gl, l, "u_hue", v.hue as number);
		setInt(
			gl,
			l,
			"u_blend",
			v.blend === "screen" ? 1 : v.blend === "add" ? 2 : 0,
		);
	},
};
