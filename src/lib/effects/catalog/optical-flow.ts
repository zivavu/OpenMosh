import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "optical-flow",
	name: "Optical Flow",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.65,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0.1,
			max: 10,
			step: 0.1,
			defaultValue: 0.5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec3 lum = vec3(0.299, 0.587, 0.114);
  float t = u_time * 0.2;

  float r = 3.0 * max(px.x, px.y);

  // 4th-order central-difference gradient, smooth and suppresses per-pixel noise
  float gxN2 = dot(texture(u_texture, v_uv - vec2(2.0*r, 0.0)).rgb, lum);
  float gxN1 = dot(texture(u_texture, v_uv - vec2(    r, 0.0)).rgb, lum);
  float gxP1 = dot(texture(u_texture, v_uv + vec2(    r, 0.0)).rgb, lum);
  float gxP2 = dot(texture(u_texture, v_uv + vec2(2.0*r, 0.0)).rgb, lum);
  float gyN2 = dot(texture(u_texture, v_uv - vec2(0.0, 2.0*r)).rgb, lum);
  float gyN1 = dot(texture(u_texture, v_uv - vec2(0.0,     r)).rgb, lum);
  float gyP1 = dot(texture(u_texture, v_uv + vec2(0.0,     r)).rgb, lum);
  float gyP2 = dot(texture(u_texture, v_uv + vec2(0.0, 2.0*r)).rgb, lum);
  float gx = (-gxP2 + 8.0*gxP1 - 8.0*gxN1 + gxN2) * (1.0/12.0);
  float gy = (-gyP2 + 8.0*gyP1 - 8.0*gyN1 + gyN2) * (1.0/12.0);

  // Curl of luminance gradient = divergence-free flow (follows colour contours)
  vec2 curl = vec2(-gy, gx);

  // Two layered sine waves at incommensurate frequencies, live animation
  float d1 = sin(v_uv.x * 3.1 + t) * cos(v_uv.y * 2.7 - t * 0.73);
  float d2 = sin(v_uv.y * 4.3 - t * 1.3 + 1.57) * cos(v_uv.x * 3.7 + t * 0.91);
  vec2 drift = vec2(d1, d2) * 0.2;

  // Soft-normalise: ensures both strong-edge and flat regions produce visible flow
  vec2 rawFlow = curl + drift;
  vec2 flowDir = rawFlow / max(length(rawFlow), 0.08);

  // LIC-style streamline accumulation: step N times backward along the flow,
  // blending colours with exponential decay weights, which gives the brush-stroke look.
  float stepLen = r * (1.0 + u_amount * 6.0);
  vec2  stepVec = flowDir * stepLen;

  vec4  color  = vec4(0.0);
  float totalW = 0.0;
  vec2  pos    = v_uv;
  const int N  = 10;
  for (int i = 0; i < N; i++) {
    float w = exp(-2.2 * float(i) / float(N - 1));
    color  += texture(u_texture, pos) * w;
    totalW += w;
    pos    -= stepVec;
  }
  vec4 acc = color / totalW;
  vec3 avg = acc.rgb;

  // Weighted averaging desaturates colours; re-expand chroma to restore vibrancy.
  float avgLuma = dot(avg, lum);
  avg = mix(vec3(avgLuma), avg, 1.35);

  outColor = vec4(clamp(avg, 0.0, 1.0), acc.a);
}`,
	animated: true,
	setUniforms: floats("amount"),
};
