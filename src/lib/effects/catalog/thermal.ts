import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "thermal",
	name: "Thermal",
	params: [
		{
			key: "intensity",
			label: "Intensity",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "palette",
			label: "Palette",
			type: "select",
			defaultValue: "thermal",
			options: [
				{ label: "Thermal", value: "thermal" },
				{ label: "Infrared", value: "infrared" },
				{ label: "Night Vision", value: "night-vision" },
			],
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_intensity;
uniform int u_palette;
vec3 thermalRamp(float t) {
  vec3 c0 = vec3(0.0, 0.0, 0.0);
  vec3 c1 = vec3(0.2, 0.0, 0.5);
  vec3 c2 = vec3(0.6, 0.0, 0.6);
  vec3 c3 = vec3(1.0, 0.0, 0.0);
  vec3 c4 = vec3(1.0, 0.5, 0.0);
  vec3 c5 = vec3(1.0, 1.0, 0.0);
  vec3 c6 = vec3(1.0, 1.0, 1.0);
  float s0 = smoothstep(0.0, 0.2, t);
  float s1 = smoothstep(0.2, 0.4, t);
  float s2 = smoothstep(0.4, 0.55, t);
  float s3 = smoothstep(0.55, 0.7, t);
  float s4 = smoothstep(0.7, 0.85, t);
  float s5 = smoothstep(0.85, 1.0, t);
  return mix(mix(mix(mix(mix(mix(c0, c1, s0), c2, s1), c3, s2), c4, s3), c5, s4), c6, s5);
}
vec3 infraredRamp(float t) {
  vec3 c0 = vec3(0.1, 0.0, 0.2);
  vec3 c1 = vec3(0.4, 0.0, 0.5);
  vec3 c2 = vec3(0.8, 0.2, 0.6);
  vec3 c3 = vec3(1.0, 0.6, 0.8);
  vec3 c4 = vec3(1.0, 1.0, 1.0);
  float s0 = smoothstep(0.0, 0.25, t);
  float s1 = smoothstep(0.25, 0.5, t);
  float s2 = smoothstep(0.5, 0.75, t);
  float s3 = smoothstep(0.75, 1.0, t);
  return mix(mix(mix(mix(c0, c1, s0), c2, s1), c3, s2), c4, s3);
}
vec3 nightVisionRamp(float t) {
  vec3 c0 = vec3(0.0, 0.05, 0.0);
  vec3 c1 = vec3(0.0, 0.3, 0.0);
  vec3 c2 = vec3(0.2, 0.6, 0.1);
  vec3 c3 = vec3(0.5, 1.0, 0.4);
  vec3 c4 = vec3(0.9, 1.0, 0.9);
  float s0 = smoothstep(0.0, 0.25, t);
  float s1 = smoothstep(0.25, 0.5, t);
  float s2 = smoothstep(0.5, 0.75, t);
  float s3 = smoothstep(0.75, 1.0, t);
  return mix(mix(mix(mix(c0, c1, s0), c2, s1), c3, s2), c4, s3);
}
void main() {
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 ramp;
  if (u_palette == 0) ramp = thermalRamp(luma);
  else if (u_palette == 1) ramp = infraredRamp(luma);
  else ramp = nightVisionRamp(luma);
  outColor = vec4(mix(c.rgb, ramp, u_intensity), c.a);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_intensity", v.intensity as number);
		const p = v.palette as string;
		setInt(
			gl,
			l,
			"u_palette",
			p === "infrared" ? 1 : p === "night-vision" ? 2 : 0,
		);
	},
};
