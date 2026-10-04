import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "sharpen",
	name: "Sharpen",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 10,
			step: 0.01,
			defaultValue: 3,
		},
		{
			key: "radius",
			label: "Radius",
			type: "range",
			min: 0.5,
			max: 25,
			step: 0.5,
			defaultValue: 5,
		},
		{
			key: "threshold",
			label: "Threshold",
			type: "range",
			min: 0,
			max: 0.25,
			step: 0.005,
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_radius;
uniform float u_threshold;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0)) * u_radius;
  vec4 c = texture(u_texture, v_uv);

  // 3x3 Gaussian blur (sigma ~0.85): center=4/16, edges=2/16, corners=1/16
  vec3 blur =
    texture(u_texture, v_uv + vec2(-px.x, -px.y)).rgb * 1.0 +
    texture(u_texture, v_uv + vec2(   0., -px.y)).rgb * 2.0 +
    texture(u_texture, v_uv + vec2( px.x, -px.y)).rgb * 1.0 +
    texture(u_texture, v_uv + vec2(-px.x,    0.)).rgb * 2.0 +
    c.rgb * 4.0 +
    texture(u_texture, v_uv + vec2( px.x,    0.)).rgb * 2.0 +
    texture(u_texture, v_uv + vec2(-px.x,  px.y)).rgb * 1.0 +
    texture(u_texture, v_uv + vec2(   0.,  px.y)).rgb * 2.0 +
    texture(u_texture, v_uv + vec2( px.x,  px.y)).rgb * 1.0;
  blur /= 16.0;

  // Unsharp mask: detail = original - blurred
  vec3 detail = c.rgb - blur;
  vec3 mask = step(vec3(u_threshold), abs(detail));
  outColor = vec4(clamp(c.rgb + detail * u_amount * mask, 0.0, 1.0), c.a);
}`,
	setUniforms: floats("amount", "radius", "threshold"),
};
