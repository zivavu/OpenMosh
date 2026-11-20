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

/** Painter's-order geometric cutout windows revealing a continuous inverted,
 * liquid thermal, or ultraviolet plasma layer underneath, delineated by
 * delicate contrast-adaptive hairlines. */
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
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Thermal palette from bright core (0) out to dark sky/smoke (1):
// lavender -> cobalt -> cyan -> neon lime -> solar yellow -> orange -> crimson.
vec3 heatRamp(float t) {
  vec3 c = mix(vec3(0.68, 0.52, 1.0), vec3(0.20, 0.48, 1.0), smoothstep(0.0, 0.16, t));
  c = mix(c, vec3(0.08, 0.90, 0.84), smoothstep(0.16, 0.34, t));
  c = mix(c, vec3(0.38, 0.96, 0.24), smoothstep(0.34, 0.54, t));
  c = mix(c, vec3(1.0, 0.86, 0.12), smoothstep(0.54, 0.72, t));
  c = mix(c, vec3(1.0, 0.40, 0.08), smoothstep(0.72, 0.87, t));
  return mix(c, vec3(0.88, 0.09, 0.14), smoothstep(0.87, 1.0, t));
}

// Ultraviolet / magenta plasma palette from bright core (0) to dark sky (1).
vec3 plasmaRamp(float t) {
  vec3 c = mix(vec3(0.88, 1.0, 0.22), vec3(1.0, 0.52, 0.10), smoothstep(0.0, 0.20, t));
  c = mix(c, vec3(1.0, 0.14, 0.62), smoothstep(0.20, 0.48, t));
  c = mix(c, vec3(0.62, 0.12, 0.94), smoothstep(0.48, 0.76, t));
  return mix(c, vec3(0.16, 0.18, 0.86), smoothstep(0.76, 1.0, t));
}

// Wide 16-tap 3-ring golden-angle blur: turns sparse sparks and smoke into one
// continuous, liquid light field with zero artificial box-edge picture frames.
float sampleLightField(float sharp) {
  vec2 pxStep = max(1.0, min(u_res.x, u_res.y) / 360.0) / u_res;
  float acc = pow(sharp, 0.72) * 0.35;
  float wsum = 0.35;
  for (int k = 0; k < 15; k++) {
    float fk = float(k);
    float a = fk * 2.39996323;
    int ring = k / 5;
    float r = ring == 0 ? 2.2 : (ring == 1 ? 5.8 : 11.5);
    float w = ring == 0 ? 0.50 : (ring == 1 ? 0.33 : 0.17);
    vec2 uv = clamp(v_uv + vec2(cos(a), sin(a)) * pxStep * r, vec2(0.0), vec2(1.0));
    float lum = dot(texture(u_texture, uv).rgb, LUMA);
    acc += pow(lum, 0.72) * w;
    wsum += w;
  }
  return acc / wsum;
}

vec3 heatFill(float sharp, float field) {
  float energy = clamp(pow(mix(sharp, field, 0.72), 0.58) * 1.38, 0.0, 1.0);
  float t = clamp(1.0 - energy, 0.0, 1.0);
  vec3 col = heatRamp(t);
  return clamp(col * (0.9 + 0.7 * (sharp - field)), 0.0, 1.0);
}

vec3 hueFill(vec3 c, float sharp, float field) {
  float energy = clamp(pow(mix(sharp, field, 0.72), 0.58) * 1.35, 0.0, 1.0);
  float t = clamp(1.0 - energy, 0.0, 1.0);
  vec3 plasma = plasmaRamp(t);
  // Blend hue-shifted chroma only where the footage itself is colorful.
  vec3 srcHsv = rgb2hsv(c);
  float chroma = smoothstep(0.12, 0.6, srcHsv.y * srcHsv.z);
  srcHsv.x = fract(srcHsv.x + 0.42);
  srcHsv.y = clamp(srcHsv.y * 1.25 + 0.2, 0.0, 1.0);
  srcHsv.z = max(srcHsv.z, 0.55);
  vec3 col = mix(plasma, hsv2rgb(srcHsv), chroma * 0.32);
  return clamp(col * (0.92 + 0.65 * (sharp - field)), 0.0, 1.0);
}

vec3 invertFill(vec3 c, float shift, int layer) {
  vec3 inv = 1.0 - c;
  inv = clamp((inv - 0.5) * 1.08 + 0.5, 0.0, 1.0);
  // Subtle micro-tone separation only when panes stack over each other.
  if (layer > 0) {
    float paneTone = 1.0 - 0.035 * clamp(shift, -1.0, 1.0);
    inv = clamp(inv * paneTone, 0.0, 1.0);
  }
  return inv;
}

void main() {
  vec4 src = texture(u_texture, v_uv);
  vec2 px = v_uv * u_res;
  float hw = 0.42 * u_lineWidth;
  float lineStrength = clamp(u_lineWidth, 0.0, 1.0);
  float inkLuma = dot(u_ink, LUMA);
  float sharp = dot(src.rgb, LUMA);

  bool hasField = false;
  float field = 0.0;
  vec3 col = src.rgb;
  int layers = 0;

  for (int i = 0; i < ${MAX_BLOCKS}; i++) {
    if (i >= u_count) break;
    vec4 r = texelFetch(u_blocks, ivec2(i, 0), 0) * u_res.xyxy;
    if (any(lessThan(px, r.xy - hw - 1.5)) || any(greaterThan(px, r.zw + hw + 1.5))) continue;
    vec4 info = texelFetch(u_blocks, ivec2(i, 1), 0);
    float alpha = info.w;
    if (alpha <= 0.005) continue;

    float d = min(min(px.x - r.x, r.z - px.x), min(px.y - r.y, r.w - px.y));
    if (d >= 0.0) {
      int bStyle = u_fill < 0 ? int(info.x + 0.5) : u_fill;
      vec3 bcol;
      if (bStyle == 0) {
        bcol = invertFill(src.rgb, info.z, layers);
      } else {
        if (!hasField) {
          field = sampleLightField(sharp);
          hasField = true;
        }
        bcol = bStyle == 1
          ? heatFill(sharp, field)
          : hueFill(src.rgb, sharp, field);
      }
      col = mix(col, bcol, alpha);
      layers++;
    }

    if (lineStrength > 0.0 && info.y > 0.0) {
      float borderMask = info.y * alpha * (1.0 - smoothstep(max(0.0, hw - 0.55), hw + 0.55, abs(d)));
      if (borderMask > 0.001) {
        // Keep hairlines readable even when white ink lands on a bright inverted block.
        float bgLuma = dot(col, LUMA);
        float contrast = abs(bgLuma - inkLuma);
        float flip = 1.0 - smoothstep(0.16, 0.46, contrast);
        vec3 edgeCol = mix(u_ink, mix(col, 1.0 - u_ink, 0.36), flip);
        col = mix(col, edgeCol, borderMask * lineStrength * 0.88);
      }
    }
  }

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
  float edge = 1.0 - smoothstep(max(0.0, v_line.y - 0.6), v_line.y + 0.6, abs(v_line.x));
  outColor = vec4(u_ink, v_line.z * edge * u_opacity);
}`;
