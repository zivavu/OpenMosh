import { H, HSV_GLSL } from "../gl/shader-lib";
import { MAX_BLOCKS } from "./blocks";

/** Shrinks the frame into the analysis grid: RGB is each cell's mean colour, A
 * its brightest pixel, so a thin spark still lights its cell. */
export const BLOCKS_POOL_FRAG =
	H +
	`uniform vec2 u_cell;
void main() {
  vec3 sum = vec3(0.0);
  float peak = 0.0;
  for (int j = 0; j < 6; j++) {
    for (int i = 0; i < 6; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / 6.0 - 0.5;
      vec3 c = texture(u_texture, v_uv + o * u_cell).rgb;
      sum += c;
      peak = max(peak, dot(c, vec3(0.299, 0.587, 0.114)));
    }
  }
  outColor = vec4(sum / 36.0, peak);
}`;

/** Fills each block (u_fill, or its own style when -1) and draws outlines in
 * u_ink. Where blocks overlap, the one the pixel sits
 * deepest inside decides the style. */
export const BLOCKS_FRAG =
	H +
	HSV_GLSL +
	`uniform highp sampler2D u_blocks;
uniform int u_count;
uniform int u_fill;
uniform vec2 u_res;
uniform float u_lineWidth;
uniform float u_opacity;
uniform vec3 u_ink;
vec3 jet(float t) {
  return clamp(vec3(1.5 - abs(4.0 * t - 3.0), 1.5 - abs(4.0 * t - 2.0), 1.5 - abs(4.0 * t - 1.0)), 0.0, 1.0);
}
vec3 stylize(vec3 c, int style, float edge) {
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  if (style == 0) return 1.0 - c;
  if (style == 1) return jet(clamp(0.52 - 0.42 * luma + 0.42 * edge, 0.0, 1.0));
  vec3 hsv = rgb2hsv(c);
  hsv.x = fract(hsv.x + 0.333);
  return hsv2rgb(hsv);
}
void main() {
  vec4 src = texture(u_texture, v_uv);
  vec2 px = v_uv * u_res;
  float hw = 0.5 * u_lineWidth;
  int style = -1;
  float depth = -1.0;
  float ink = 0.0;
  for (int i = 0; i < ${MAX_BLOCKS}; i++) {
    if (i >= u_count) break;
    vec4 r = texelFetch(u_blocks, ivec2(i, 0), 0) * u_res.xyxy;
    if (any(lessThan(px, r.xy - hw - 1.0)) || any(greaterThan(px, r.zw + hw + 1.0))) continue;
    vec4 info = texelFetch(u_blocks, ivec2(i, 1), 0);
    float d = min(min(px.x - r.x, r.z - px.x), min(px.y - r.y, r.w - px.y));
    if (d >= 0.0) {
      float dn = d / max(1.0, 0.5 * min(r.z - r.x, r.w - r.y));
      if (dn > depth) {
        depth = dn;
        style = u_fill < 0 ? int(info.x) : u_fill;
      }
    }
    ink = max(ink, info.y * (1.0 - smoothstep(hw - 0.5, hw + 0.5, abs(d))));
  }
  vec3 col = src.rgb;
  if (style >= 0) col = stylize(src.rgb, style, 1.0 - smoothstep(0.0, 0.7, depth));
  // Under a pixel wide, lines fade rather than stay a pixel.
  col = mix(col, u_ink, ink * clamp(u_lineWidth, 0.0, 1.0));
  outColor = vec4(mix(src.rgb, col, u_opacity), src.a);
}`;

/** Link ribbons, positioned in normalized coords with y from the top, the way
 * the chain's textures run. */
export const RIBBON_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec3 a_line;
out vec3 v_line;
void main() {
  v_line = a_line;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const RIBBON_FRAG = `#version 300 es
precision highp float;
uniform vec3 u_ink;
uniform float u_opacity;
in vec3 v_line;
out vec4 outColor;
void main() {
  float edge = 1.0 - smoothstep(v_line.y - 0.5, v_line.y + 0.5, abs(v_line.x));
  outColor = vec4(u_ink, v_line.z * edge * u_opacity);
}`;
