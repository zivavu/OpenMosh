import { H, HSV_GLSL, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "neon-edges",
	name: "Neon Edges",
	params: [
		{
			key: "strength",
			label: "Strength",
			type: "range",
			min: 0.1,
			max: 5.0,
			step: 0.1,
			defaultValue: 1.5,
		},
		{
			key: "glow",
			label: "Glow",
			type: "range",
			min: 0.0,
			max: 3.0,
			step: 0.05,
			defaultValue: 1.0,
		},
		{
			key: "bg",
			label: "Background",
			type: "range",
			min: 0.0,
			max: 1.0,
			step: 0.01,
			defaultValue: 0.05,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		HSV_GLSL +
		`uniform float u_strength;
uniform float u_glow;
uniform float u_bg;

void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 orig = texture(u_texture, v_uv);

  // Sobel on pre-blurred luminance: each tap is a 2x2 average, suppressing
  // pixel noise for smooth edges
  vec3 luma = vec3(0.299, 0.587, 0.114);
  vec2 h = px * 0.5;
  #define SLUM(o) dot( \
    texture(u_texture, v_uv+(o)+vec2(-h.x,-h.y)).rgb + \
    texture(u_texture, v_uv+(o)+vec2( h.x,-h.y)).rgb + \
    texture(u_texture, v_uv+(o)+vec2(-h.x, h.y)).rgb + \
    texture(u_texture, v_uv+(o)+vec2( h.x, h.y)).rgb, luma) * 0.25
  vec2 S = px * 1.5;
  float tl = SLUM(vec2(-S.x,-S.y));
  float tm = SLUM(vec2( 0.0,-S.y));
  float tr = SLUM(vec2( S.x,-S.y));
  float ml = SLUM(vec2(-S.x, 0.0));
  float mr = SLUM(vec2( S.x, 0.0));
  float bl = SLUM(vec2(-S.x, S.y));
  float bm = SLUM(vec2( 0.0, S.y));
  float br = SLUM(vec2( S.x, S.y));
  #undef SLUM
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  float edge = clamp(sqrt(gx*gx + gy*gy) * u_strength, 0.0, 1.0);

  vec3 hsv = rgb2hsv(orig.rgb);
  vec3 neon = hsv2rgb(vec3(hsv.x, 1.0, 1.0));

  vec3 glowAccum = vec3(0.0);
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec2 off = vec2(float(x), float(y)) * px * 3.0;
      vec3 s = texture(u_texture, v_uv + off).rgb;
      vec3 sh = rgb2hsv(s);
      glowAccum += hsv2rgb(vec3(sh.x, 1.0, 1.0));
    }
  }
  glowAccum /= 25.0;

  vec3 bg = orig.rgb * u_bg * (1.0 - edge);

  vec3 result = neon * edge + glowAccum * sqrt(edge) * u_glow * 0.4 + bg;
  outColor = vec4(clamp(result, 0.0, 1.0), orig.a);
}`,
	setUniforms: floats("strength", "glow", "bg"),
};
