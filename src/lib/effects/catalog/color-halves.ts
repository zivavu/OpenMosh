import { H, HUE_ROTATE_GLSL, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "color-halves",
	name: "Color Halves",
	params: [
		{
			key: "position",
			label: "Position",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 360,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "mode",
			label: "Mode",
			type: "select",
			defaultValue: "invert",
			options: [
				{ label: "Invert", value: "invert" },
				{ label: "Hue Shift", value: "hue-shift" },
				{ label: "Desaturate", value: "desaturate" },
				{ label: "High Contrast", value: "high-contrast" },
			],
		},
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		HUE_ROTATE_GLSL +
		`uniform float u_position;
uniform float u_angle;
uniform int u_mode;
uniform float u_amount;
void main() {
  vec4 orig = texture(u_texture, v_uv);
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 center = vec2(0.5);
  vec2 uv = v_uv - center;
  float c = cos(rad), s = sin(rad);
  float proj = uv.x * c + uv.y * s;
  float feather = 0.02;
  float side = smoothstep(u_position - feather, u_position + feather, proj + 0.5);
  vec3 treated = orig.rgb;
  if (u_mode == 0) {
    treated = hueRotate(treated, 180.0);
  } else if (u_mode == 1) {
    treated = hueRotate(treated, 120.0);
  } else if (u_mode == 2) {
    float luma = dot(treated, vec3(0.299, 0.587, 0.114));
    treated = mix(treated, vec3(luma), 1.0);
  } else {
    treated = clamp((orig.rgb - 0.5) * 2.0 + 0.5, 0.0, 1.0);
  }
  vec3 result = mix(orig.rgb, treated, side * u_amount);
  outColor = vec4(result, orig.a);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_position", v.position as number);
		setFloat(gl, l, "u_angle", v.angle as number);
		const m = v.mode as string;
		setInt(
			gl,
			l,
			"u_mode",
			m === "hue-shift"
				? 1
				: m === "desaturate"
					? 2
					: m === "high-contrast"
						? 3
						: 0,
		);
		setFloat(gl, l, "u_amount", v.amount as number);
	},
};
