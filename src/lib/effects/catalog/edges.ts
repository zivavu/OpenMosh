import { H, setColor, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "edges",
	name: "Edges",
	params: [
		{
			key: "strength",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "passthru",
			label: "Passthru",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
		},
		{
			key: "thickness",
			label: "Thickness",
			type: "range",
			min: 1,
			max: 10,
			step: 0.1,
			defaultValue: 1,
			moshMax: 4,
		},
		{
			key: "colorMode",
			label: "Color",
			type: "select",
			defaultValue: "image",
			options: [
				{ label: "Image", value: "image" },
				{ label: "Custom", value: "custom" },
			],
		},
		{
			key: "edgeColor",
			label: "Edge Color",
			type: "color",
			defaultValue: "#ffffff",
			visibleWhen: (v) => v.colorMode === "custom",
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_strength;
uniform float u_passthru;
uniform float u_thickness;
uniform int u_custom;
uniform vec3 u_edgeColor;
/** Per-channel Sobel magnitude at a radius of r pixels; 1.0 for a full black-white step. */
vec3 sobel(vec2 r) {
  vec3 tl = texture(u_texture, v_uv + vec2(-r.x, -r.y)).rgb;
  vec3 tm = texture(u_texture, v_uv + vec2( 0.0, -r.y)).rgb;
  vec3 tr = texture(u_texture, v_uv + vec2( r.x, -r.y)).rgb;
  vec3 ml = texture(u_texture, v_uv + vec2(-r.x,  0.0)).rgb;
  vec3 mr = texture(u_texture, v_uv + vec2( r.x,  0.0)).rgb;
  vec3 bl = texture(u_texture, v_uv + vec2(-r.x,  r.y)).rgb;
  vec3 bm = texture(u_texture, v_uv + vec2( 0.0,  r.y)).rgb;
  vec3 br = texture(u_texture, v_uv + vec2( r.x,  r.y)).rgb;
  vec3 gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  vec3 gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  return sqrt(gx*gx + gy*gy) * 0.25;
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  // Half scale too, so thick lines don't skip detail thinner than their radius.
  vec3 mag = max(sobel(px * u_thickness), sobel(px * max(u_thickness * 0.5, 1.0)));
  // Past a small floor, so grain and compression noise don't speckle.
  vec3 lines = clamp((mag * u_strength * 4.0 - 0.05) / 0.95, 0.0, 1.0);
  vec4 orig = texture(u_texture, v_uv);
  vec3 bg = orig.rgb * u_passthru;
  vec3 c = u_custom == 1
    ? mix(bg, u_edgeColor, max(lines.r, max(lines.g, lines.b)))
    : 1.0 - (1.0 - bg) * (1.0 - lines);
  outColor = vec4(c, orig.a);
}`,
	linearFilter: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_strength", v.strength as number);
		setFloat(gl, l, "u_passthru", v.passthru as number);
		setFloat(gl, l, "u_thickness", v.thickness as number);
		setInt(gl, l, "u_custom", v.colorMode === "custom" ? 1 : 0);
		setColor(gl, l, "u_edgeColor", v.edgeColor as string);
	},
};
