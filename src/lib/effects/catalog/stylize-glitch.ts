import { clockParams } from "../clock-params";
import { H, HASH_GLSL, HSV_GLSL, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "stylize-glitch",
	name: "Stylize Glitch",
	params: [
		{
			key: "level",
			label: "Glitch Size",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		...clockParams(
			"Glitch Rate",
			{ min: 1, max: 120, step: 1, defaultValue: 30 },
			"roll",
		),
		{
			key: "count",
			label: "Count",
			type: "range",
			min: 1,
			max: 10,
			step: 1,
			defaultValue: 4,
		},
		{
			key: "mode",
			label: "Style",
			type: "select",
			defaultValue: "random",
			options: [
				{ label: "Random", value: "random" },
				{ label: "Invert", value: "invert" },
				{ label: "Dither", value: "dither" },
				{ label: "Hue Shift", value: "hue" },
			],
		},
	],
};

/** Vidvox Stylize Glitch: random rectangles get inverted, dithered or hue
 * shifted. The 8x8 Bayer threshold is computed rather than tabled. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		HASH_GLSL +
		HSV_GLSL +
		`uniform float u_level;
uniform float u_count;
uniform int u_mode;
uniform vec2 u_resolution;
vec4 rand4(vec4 co) {
  return vec4(hash(co.rg), hash(co.gb), hash(co.ba), hash(co.rb));
}
float bayer8(vec2 p) {
  ivec2 ip = ivec2(mod(p, 8.0));
  int a = ip.x ^ ip.y;
  int b = ip.y;
  int r = ((a & 1) << 5) | ((b & 1) << 4) | ((a & 2) << 2) | ((b & 2) << 1)
        | ((a & 4) >> 1) | ((b & 4) >> 2);
  return (float(r) + 1.0) / 64.0;
}
vec4 stylize(vec4 col, int style) {
  if (style == 0) return vec4(1.0 - col.rgb, col.a);
  if (style == 1) {
    float luma = (col.r + col.g + col.b) / 3.0;
    return vec4(col.rgb * step(bayer8(v_uv * u_resolution), luma), col.a);
  }
  vec3 hsv = rgb2hsv(col.rgb);
  hsv.x = mod(hsv.x + 0.333, 1.0);
  return vec4(hsv2rgb(hsv), col.a);
}
void main() {
  vec4 col = texture(u_texture, v_uv);
  if (u_level > 0.0) {
    // One re-roll per unit of phase, so a beat division re-rolls on the beat.
    float tick = floor(u_time);
    for (int i = 0; i < 10; i++) {
      if (float(i) >= u_count) break;
      vec4 rc = rand4((float(i) + tick) * vec4(0.2123, 0.34517, 0.53428, 0.7431));
      rc.zw *= u_level;
      rc.zw = min(rc.zw, 1.0 - rc.xy);
      if (all(greaterThanEqual(v_uv, rc.xy)) && all(lessThanEqual(v_uv, rc.xy + rc.zw))) {
        int style = u_mode == 0
          ? int(min(3.0 * hash(vec2(2.7413 + float(i), 1.325821 * tick)), 2.0))
          : u_mode - 1;
        col = stylize(col, style);
      }
    }
  }
  outColor = col;
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_level", v.level as number);
		setFloat(gl, l, "u_count", v.count as number);
		setInt(
			gl,
			l,
			"u_mode",
			v.mode === "invert"
				? 1
				: v.mode === "dither"
					? 2
					: v.mode === "hue"
						? 3
						: 0,
		);
	},
};
