import { clockParams } from "../clock-params";
import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "ring-warp",
	name: "Ring Warp",
	params: [
		{
			key: "rings",
			label: "Rings",
			type: "range",
			min: 0.1,
			max: 32,
			step: 0.1,
			defaultValue: 4,
			curve: 2,
			moshMax: 12,
		},
		{
			key: "offset",
			label: "Phase",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		...clockParams("Speed", {
			min: 0,
			max: 3,
			step: 0.05,
			defaultValue: 0.3,
			moshMax: 1,
		}),
		{
			key: "mode",
			label: "Mode",
			type: "select",
			defaultValue: "single",
			options: [
				{ label: "Single", value: "single" },
				{ label: "Double", value: "double" },
			],
		},
		{
			key: "xSmear",
			label: "X Smear",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "ySmear",
			label: "Y Smear",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "centerX",
			label: "Center X",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "centerY",
			label: "Center Y",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
	],
};

/** Vidvox Ripples: concentric rings fold the radius in and out. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_rings;
uniform float u_offset;
uniform float u_xSmear;
uniform float u_ySmear;
uniform float u_centerX;
uniform float u_centerY;
uniform int u_mode;
uniform vec2 u_resolution;
const float PI = 3.14159265359;
void main() {
  vec2 tc = v_uv * u_resolution;
  vec2 c = vec2(u_centerX, u_centerY) * u_resolution;
  float R = length(u_resolution);
  float r = distance(c, tc);
  float a = atan(tc.y - c.y, tc.x - c.x);
  tc -= c;
  if (r < R) {
    float pct = r / R;
    float off = (u_offset + u_time) * 2.0 * PI;
    float wave = u_mode == 0
      ? sin(pct * u_rings * 2.0 * PI + off)
      : sin(pct * u_rings * 2.0 * PI * cos(off + pct * pct * u_rings * 2.0 * PI));
    float rr = r * (1.0 + wave) * 0.5;
    tc = vec2(rr * cos(a), rr * sin(a));
    tc.x = mix(v_uv.x * u_resolution.x - c.x, tc.x, max(1.0 - u_xSmear, 0.001));
    tc.y = mix(v_uv.y * u_resolution.y - c.y, tc.y, max(1.0 - u_ySmear, 0.001));
  }
  vec2 loc = (tc + c) / u_resolution;
  if (any(lessThan(loc, vec2(0.0))) || any(greaterThan(loc, vec2(1.0)))) {
    outColor = vec4(0.0);
  } else {
    outColor = texture(u_texture, loc);
  }
}`,
	animated: true,
	linearFilter: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_rings", v.rings as number);
		setFloat(gl, l, "u_offset", v.offset as number);
		setFloat(gl, l, "u_xSmear", v.xSmear as number);
		setFloat(gl, l, "u_ySmear", v.ySmear as number);
		setFloat(gl, l, "u_centerX", v.centerX as number);
		setFloat(gl, l, "u_centerY", v.centerY as number);
		setInt(gl, l, "u_mode", v.mode === "double" ? 1 : 0);
	},
};
