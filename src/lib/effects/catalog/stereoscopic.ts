import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "stereoscopic",
	name: "Stereoscopic",
	params: [
		{
			key: "depth",
			label: "Depth",
			type: "range",
			min: 0,
			max: 50,
			step: 1,
			defaultValue: 10,
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
			defaultValue: "anaglyph",
			options: [
				{ label: "Anaglyph", value: "anaglyph" },
				{ label: "Color Split", value: "color-split" },
			],
		},
		{
			key: "depthSource",
			label: "Depth Source",
			type: "select",
			defaultValue: "luminance",
			options: [
				{ label: "Luminance", value: "luminance" },
				{ label: "Edges", value: "edges" },
				{ label: "Flat", value: "flat" },
			],
		},
		{
			key: "focus",
			label: "Focus",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_depth;
uniform float u_angle;
uniform int u_mode;
uniform int u_depthSource;
uniform float u_focus;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 c = texture(u_texture, v_uv);

  float d;
  if (u_depthSource == 0) {
    d = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  } else if (u_depthSource == 1) {
    float lL = dot(texture(u_texture, v_uv + vec2(-px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lR = dot(texture(u_texture, v_uv + vec2( px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lT = dot(texture(u_texture, v_uv + vec2(0.0, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
    float lB = dot(texture(u_texture, v_uv + vec2(0.0,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
    d = clamp(length(vec2(lR - lL, lB - lT)) * 4.0, 0.0, 1.0);
  } else {
    d = 1.0;
  }

  // offset centered around focus point (focus inverted: high focus = less offset)
  float offset = (d - (1.0 - u_focus)) * u_depth;
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad)) * offset * px;

  if (u_mode == 0) {
    float r = texture(u_texture, v_uv + dir).r;
    vec2 gb = texture(u_texture, v_uv - dir).gb;
    outColor = vec4(r, gb, c.a);
  } else {
    float r = texture(u_texture, v_uv + dir).r;
    float g = texture(u_texture, v_uv).g;
    float b = texture(u_texture, v_uv - dir).b;
    outColor = vec4(r, g, b, c.a);
  }
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_depth", v.depth as number);
		setFloat(gl, l, "u_angle", v.angle as number);
		const m = v.mode as string;
		setInt(gl, l, "u_mode", m === "color-split" ? 1 : 0);
		const ds = v.depthSource as string;
		setInt(gl, l, "u_depthSource", ds === "edges" ? 1 : ds === "flat" ? 2 : 0);
		setFloat(gl, l, "u_focus", v.focus as number);
	},
};
