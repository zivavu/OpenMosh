import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "channel-split",
	name: "Channel Split",
	params: [
		{
			key: "mode",
			label: "Mode",
			type: "select",
			defaultValue: "linear",
			options: [
				{ label: "Linear", value: "linear" },
				{ label: "Radial", value: "radial" },
				{ label: "Prismatic", value: "prismatic" },
			],
		},
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 50,
			step: 0.1,
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
			visibleWhen: (v) => v.mode === "linear" || v.mode === "prismatic",
		},
		{
			key: "falloff",
			label: "Falloff",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			visibleWhen: (v) => v.mode === "radial",
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0,
			max: 5,
			step: 0.1,
			defaultValue: 1,
			visibleWhen: (v) => v.mode === "prismatic",
		},
		{
			key: "saturation",
			label: "Hue Shift",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			visibleWhen: (v) => v.mode === "prismatic",
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform int u_mode;
uniform float u_amount;
uniform float u_angle;
uniform float u_falloff;
uniform float u_saturation;
uniform float u_speed;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));

  if (u_mode == 0) {
    float rad = u_angle * 3.14159265 / 180.0;
    vec2 d = vec2(cos(rad), sin(rad)) * u_amount * px;
    outColor = vec4(
      texture(u_texture, v_uv + d).r,
      texture(u_texture, v_uv).g,
      texture(u_texture, v_uv - d).b,
      texture(u_texture, v_uv).a
    );
  } else if (u_mode == 1) {
    vec2 center = vec2(0.5);
    vec2 dir = v_uv - center;
    float dist = length(dir);
    float strength = u_amount * pow(dist, 1.0 + u_falloff * 3.0) * 0.002;
    vec2 offset = normalize(dir + 1e-6) * strength;
    outColor = vec4(
      texture(u_texture, v_uv + offset).r,
      texture(u_texture, v_uv).g,
      texture(u_texture, v_uv - offset).b,
      texture(u_texture, v_uv).a
    );
  } else {
    float t = u_time * u_speed;
    float rad = u_angle * 3.14159265 / 180.0;
    vec2 dir = vec2(cos(rad), sin(rad));
    float pos = dot(v_uv - 0.5, dir);
    float disp = u_amount * 0.0016;
    float drift = sin(t * 0.3) * 0.5;
    vec2 uvR = v_uv - dir * disp * (pos + drift);
    vec2 uvB = v_uv + dir * disp * (pos + drift);
    float r = texture(u_texture, uvR).r;
    float g = texture(u_texture, v_uv).g;
    float b = texture(u_texture, uvB).b;
    // Widest coverage of the three taps, so a split text layer keeps every channel it displaced.
    float a = max(texture(u_texture, uvR).a,
                  max(texture(u_texture, v_uv).a, texture(u_texture, uvB).a));
    vec3 color = vec3(r, g, b);
    float hueShift = pos * u_amount * 0.1 + t * 0.2;
    float cosH = cos(hueShift);
    float sinH = sin(hueShift);
    vec3 k = vec3(0.57735);
    vec3 rotated = color * cosH + cross(k, color) * sinH + k * dot(k, color) * (1.0 - cosH);
    color = mix(color, rotated, u_saturation);
    outColor = vec4(color, a);
  }
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		const mode = v.mode === "radial" ? 1 : v.mode === "prismatic" ? 2 : 0;
		setInt(gl, l, "u_mode", mode);
		setFloat(gl, l, "u_amount", v.amount as number);
		setFloat(gl, l, "u_angle", v.angle as number);
		setFloat(gl, l, "u_falloff", v.falloff as number);
		setFloat(gl, l, "u_saturation", v.saturation as number);
		setFloat(gl, l, "u_speed", v.speed as number);
	},
};
