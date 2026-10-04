import { H, setColor, setFloat } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "sobel-neon",
	name: "Sobel Neon",
	params: [
		{
			key: "width",
			label: "Edge Width",
			type: "range",
			min: 0.05,
			max: 5,
			step: 0.05,
			defaultValue: 1,
		},
		{
			key: "neon",
			label: "Neon",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "brightness",
			label: "Brightness",
			type: "range",
			min: 0.2,
			max: 2,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "bgFade",
			label: "Background",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "bgColor",
			label: "Background Color",
			type: "color",
			defaultValue: "#000000",
		},
	],
};

/** XPL EdgeDetectionSobelNeonV2: the Sobel gradient kept in colour. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_width;
uniform float u_neon;
uniform float u_brightness;
uniform float u_bgFade;
uniform vec3 u_bgColor;
uniform vec2 u_resolution;
vec3 sobel(vec2 st, vec2 c) {
  vec3 tl = texture(u_texture, c + vec2(-st.x, st.y)).rgb;
  vec3 ml = texture(u_texture, c + vec2(-st.x, 0.0)).rgb;
  vec3 bl = texture(u_texture, c + vec2(-st.x, -st.y)).rgb;
  vec3 mt = texture(u_texture, c + vec2(0.0, st.y)).rgb;
  vec3 mb = texture(u_texture, c + vec2(0.0, -st.y)).rgb;
  vec3 tr = texture(u_texture, c + vec2(st.x, st.y)).rgb;
  vec3 mr = texture(u_texture, c + vec2(st.x, 0.0)).rgb;
  vec3 br = texture(u_texture, c + vec2(st.x, -st.y)).rgb;
  vec3 gx = tl + 2.0 * ml + bl - tr - 2.0 * mr - br;
  vec3 gy = -tl - 2.0 * mt - tr + bl + 2.0 * mb + br;
  return sqrt(gx * gx + gy * gy);
}
void main() {
  vec4 scene = texture(u_texture, v_uv);
  vec3 grad = sobel(u_width / u_resolution, v_uv);
  vec3 bg = mix(u_bgColor, scene.rgb, u_bgFade);
  vec3 col = mix(bg, grad, u_neon) * u_brightness;
  outColor = vec4(clamp(col, 0.0, 1.0), scene.a);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_width", v.width as number);
		setFloat(gl, l, "u_neon", v.neon as number);
		setFloat(gl, l, "u_brightness", v.brightness as number);
		setFloat(gl, l, "u_bgFade", v.bgFade as number);
		setColor(gl, l, "u_bgColor", v.bgColor as string);
	},
};
