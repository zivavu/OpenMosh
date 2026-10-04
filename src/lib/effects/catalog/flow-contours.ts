import { H, HUE_ROTATE_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "flow-contours",
	name: "Flow Contours",
	params: [
		{
			key: "bands",
			label: "Bands",
			type: "range",
			min: 2,
			max: 24,
			step: 1,
			defaultValue: 8,
		},
		{
			key: "flow",
			label: "Flow",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.45,
		},
		{
			key: "cycle",
			label: "Hue Cycle",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "sheen",
			label: "Sheen",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.4,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		HUE_ROTATE_GLSL +
		`uniform float u_bands;
uniform float u_flow;
uniform float u_cycle;
uniform float u_sheen;
uniform float u_delta;
uniform vec2 u_resolution;
uniform sampler2D u_feedback;
void main() {
  vec2 px = 1.0 / u_resolution;
  vec3 lumW = vec3(0.299, 0.587, 0.114);
  vec3 src = texture(u_texture, v_uv).rgb;
  float l = dot(src, lumW);

  // Luminance gradient: contour lines run perpendicular to it.
  float lx = dot(texture(u_texture, clamp(v_uv + vec2(px.x, 0.0), vec2(0.0), vec2(1.0))).rgb, lumW);
  float ly = dot(texture(u_texture, clamp(v_uv + vec2(0.0, px.y), vec2(0.0), vec2(1.0))).rgb, lumW);
  vec2 grad = vec2(lx - l, ly - l);
  float slope = length(grad);

  float bands = max(2.0, floor(u_bands));
  float band = floor(l * bands);

  // Neighbouring bands slide in opposite directions along the terrain gradient, so
  // the contours shear against each other rather than translating as one sheet.
  float dirSign = mod(band, 2.0) * 2.0 - 1.0;
  vec2 flow = (grad / max(slope, 1e-4)) * dirSign * u_flow * u_delta * 0.2;
  vec4 prevS = texture(u_feedback, clamp(v_uv - flow, vec2(0.0), vec2(1.0)));
  vec3 prev = prevS.rgb;

  // Quantise luminance while keeping the source chroma, then cycle hue per band.
  vec3 quant = src * ((band + 0.5) / bands) / max(l, 0.02);
  float q = band / bands;
  quant = clamp(hueRotate(clamp(quant, 0.0, 1.0), (q * 360.0 + u_time * 50.0) * u_cycle), 0.0, 1.0);

  // Contour seam. fwidth gives the width the band edge occupies on screen, so the
  // line stays a couple of pixels thick at any band count.
  float terrain = l * bands;
  float w = max(fwidth(terrain), 1e-4);
  float edge = fract(terrain);
  float seam = 1.0 - smoothstep(w, w * 2.5, min(edge, 1.0 - edge));
  seam *= smoothstep(0.0, 0.6, slope * bands * 6.0);

  // Light the seam from a fixed direction so ridges facing the light catch it.
  vec2 n = grad / max(slope, 1e-4);
  float lambert = 0.25 + 0.75 * clamp(dot(n, vec2(-0.6, 0.8)), 0.0, 1.0);

  // Screen-blend a tinted highlight into the band colour instead of adding white, and
  // do it before the feedback mix: added afterwards it compounds every frame until flat white.
  vec3 spec = mix(quant, vec3(1.0), 0.45);
  float s = clamp(seam * lambert * u_sheen, 0.0, 1.0);
  vec3 lit = 1.0 - (1.0 - quant) * (1.0 - spec * s);

  float blend = 1.0 - exp(-mix(9.0, 1.5, u_flow) * u_delta);
  vec3 col = mix(prev, lit, blend);
  float colA = mix(prevS.a, texture(u_texture, v_uv).a, blend);

  outColor = vec4(clamp(col, 0.0, 1.0), clamp(colA, 0.0, 1.0));
}`,
	animated: true,
	setUniforms: floats("bands", "flow", "cycle", "sheen"),
};
