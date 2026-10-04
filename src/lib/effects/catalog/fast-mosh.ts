import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "fast-mosh",
	name: "Fast Mosh",
	params: [
		{
			key: "hold",
			label: "Hold Keyframe",
			type: "checkbox",
			defaultValue: 0,
		},
		{
			key: "rate",
			label: "Update Rate",
			type: "range",
			min: 0.01,
			max: 1,
			step: 0.01,
			defaultValue: 0.95,
			moshMin: 0.5,
		},
		{
			key: "block",
			label: "Block Size",
			type: "range",
			min: 2,
			max: 64,
			step: 1,
			defaultValue: 16,
		},
		{
			key: "sharpen",
			label: "Sharpen",
			type: "range",
			min: 0,
			max: 10,
			step: 0.1,
			defaultValue: 1,
			moshMax: 3,
		},
		{
			key: "blur",
			label: "Blur",
			type: "range",
			min: 0,
			max: 2,
			step: 0.01,
			defaultValue: 0.25,
			moshMax: 1,
		},
		{
			key: "posterize",
			label: "Posterize",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.25,
		},
		{
			key: "mode",
			label: "Mode",
			type: "select",
			defaultValue: "relative",
			options: [
				{ label: "Relative", value: "relative" },
				{ label: "Absolute", value: "absolute" },
				{ label: "Difference", value: "difference" },
			],
		},
	],
};

/** Vidvox FastMosh: the frame-to-frame difference is painted onto a blocky
 * keyframe that can be held, the whole datamosh look without the codec. */
export const shader: EffectShaderDef = {
	prePasses: [
		{
			fragment:
				H +
				`uniform float u_hold;
uniform sampler2D u_feedback;
void main() {
  outColor = u_hold > 0.5 ? texture(u_feedback, v_uv) : texture(u_texture, v_uv);
}`,
			feedback: true,
		},
	],
	fragment:
		H +
		`uniform float u_rate;
uniform float u_sharpen;
uniform float u_blur;
uniform float u_posterize;
uniform float u_block;
uniform int u_mode;
uniform vec2 u_resolution;
uniform sampler2D u_original;
uniform sampler2D u_feedback;
// The keyframe read as if it were a 1/block-size buffer scaled back up with bilinear filtering.
vec4 keyAt(vec2 uv) {
  vec2 cells = max(u_resolution / u_block, vec2(1.0));
  vec2 g = uv * cells - 0.5;
  vec2 i = floor(g);
  vec2 f = fract(g);
  vec4 a = texture(u_texture, (i + 0.5) / cells);
  vec4 b = texture(u_texture, (i + vec2(1.5, 0.5)) / cells);
  vec4 c = texture(u_texture, (i + vec2(0.5, 1.5)) / cells);
  vec4 d = texture(u_texture, (i + 1.5) / cells);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 px = 1.0 / u_resolution;
  vec4 color = texture(u_original, v_uv);
  vec4 cl = texture(u_original, v_uv + vec2(-px.x, 0.0));
  vec4 cr = texture(u_original, v_uv + vec2(px.x, 0.0));
  vec4 ca = texture(u_original, v_uv + vec2(0.0, px.y));
  vec4 cb = texture(u_original, v_uv + vec2(0.0, -px.y));
  vec4 cla = texture(u_original, v_uv + vec2(-px.x, px.y));
  vec4 cra = texture(u_original, v_uv + px);
  vec4 clb = texture(u_original, v_uv - px);
  vec4 crb = texture(u_original, v_uv + vec2(px.x, -px.y));
  vec4 ring = cl + cr + ca + cb + cla + cra + clb + crb;
  vec4 key = keyAt(v_uv);
  vec4 prev = texture(u_feedback, v_uv);
  vec4 diff = color - prev;
  if (u_blur > 0.0) diff = diff * (1.0 - u_blur) + ring * (u_blur / 8.0);
  vec4 fin;
  if (u_mode == 0) fin = mix(prev, diff + key, u_rate);
  else if (u_mode == 1) fin = mix(prev, abs(diff) + key, u_rate);
  else fin = mix(prev, abs(diff + prev) * key, u_rate);
  if (u_posterize > 0.0) {
    float q = 128.0 - u_posterize * 126.0;
    fin = floor(fin * q) / q;
  }
  if (u_sharpen > 0.0) fin += u_sharpen * (8.0 * color - ring);
  outColor = vec4(clamp(fin.rgb, 0.0, 1.0), color.a);
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_hold", v.hold as number);
		setFloat(gl, l, "u_rate", v.rate as number);
		setFloat(gl, l, "u_sharpen", v.sharpen as number);
		setFloat(gl, l, "u_blur", v.blur as number);
		setFloat(gl, l, "u_posterize", v.posterize as number);
		setFloat(gl, l, "u_block", v.block as number);
		setInt(
			gl,
			l,
			"u_mode",
			v.mode === "absolute" ? 1 : v.mode === "difference" ? 2 : 0,
		);
	},
};
