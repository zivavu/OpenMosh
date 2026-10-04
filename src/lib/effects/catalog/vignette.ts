import { H, setColor, setFloat } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "vignette",
	name: "Vignette",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "feather",
			label: "Feather",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "roundness",
			label: "Roundness",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "color",
			label: "Color",
			type: "color",
			defaultValue: "#000000",
		},
		// Checkbox on purpose: a mosh only rolls range and select params, so
		// this stays put.
		{
			key: "transparent",
			label: "Transparent",
			type: "checkbox",
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_feather;
uniform float u_roundness;
uniform vec3 u_color;
uniform float u_transparent;
uniform float u_mediaFill;
void main() {
  vec4 c = texture(u_texture, v_uv);
  // 1 at the media's sides, not the bleed margin's, so full amount clears its edge.
  vec2 d = abs(v_uv - 0.5) * 2.0 / u_mediaFill;
  // Superellipse: 0 hugs the frame's rectangle, 1 is the ellipse inscribed in it.
  float p = mix(10.0, 2.0, u_roundness);
  float r = pow(pow(d.x, p) + pow(d.y, p), 1.0 / p);
  float width = mix(0.01, 1.0, u_feather);
  // Zero amount starts the ramp past the corners (1.42); full amount ends it at the sides.
  float outer = 1.0 + (1.0 - u_amount) * (0.42 + width);
  float cover = smoothstep(outer - width, outer, r);
  outColor = u_transparent > 0.5
    ? vec4(c.rgb, c.a * (1.0 - cover))
    : vec4(mix(c.rgb, u_color, cover), c.a);
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_amount", v.amount as number);
		setFloat(gl, l, "u_feather", v.feather as number);
		setFloat(gl, l, "u_roundness", v.roundness as number);
		setColor(gl, l, "u_color", v.color as string);
		setFloat(gl, l, "u_transparent", v.transparent as number);
	},
};
