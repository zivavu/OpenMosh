import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "composite",
	name: "Composite",
	params: [
		{
			key: "bleed",
			label: "Bleed",
			type: "range",
			min: 0,
			max: 32,
			step: 0.5,
			defaultValue: 11,
		},
		{
			key: "crawl",
			label: "Crawl",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.45,
		},
		{
			key: "crush",
			label: "Crush",
			type: "range",
			min: 0,
			max: 0.6,
			step: 0.01,
			defaultValue: 0.2,
		},
		{
			key: "mix",
			label: "Mix",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
			// Under half reads as a mild sharpen; the signal falls apart once it
			// mostly replaces the frame.
			moshMin: 0.65,
		},
	],
};

/** Composite video falling apart. The speckle comes from decoding, so it lands
 * on detail and leaves flat areas alone: luma is held into runs then over-peaked. */
export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_bleed;
uniform float u_crawl;
uniform float u_crush;
uniform float u_mix;
// Pinned rather than exposed: these four only read as this signal near the top of their ranges.
const float RUN = 24.0;
const float LINES = 8.0;
const float RING = 5.0;
const float BLOOM = 2.0;
// Sine-free hash (Dave Hoskins): stable on ANGLE/D3D for large line numbers.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 chromaOf(vec3 c) {
  return vec2(dot(c, vec3(0.5959, -0.2746, -0.3213)),
              dot(c, vec3(0.2115, -0.5227, 0.3112)));
}
vec3 yiq2rgb(float y, vec2 c) {
  return vec3(y + 0.956 * c.x + 0.619 * c.y,
              y - 0.272 * c.x - 0.647 * c.y,
              y - 1.106 * c.x + 1.703 * c.y);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 pos = v_uv * res;
  vec4 src = texture(u_texture, v_uv);

  // Everything below is computed per scan line, so nothing lines up vertically:
  // that mismatch is the comb texture.
  float row = floor(pos.y / LINES);
  float rowY = (row + 0.5) * LINES;
  float rh = hash(vec2(row, floor(u_time * 24.0)));
  // Hold length wanders line to line; a fixed one would read as a tidy grid.
  float run = RUN * (0.45 + 1.1 * rh);
  float ph = fract(rh * 7.13) * run;

  // Luma: latch one sample and smear it across the run, so an edge leaves a flat bar.
  float held = luma(texture(u_texture, vec2((floor((pos.x + ph) / run) + 0.5) * run - ph, rowY) / res).rgb);
  // Over-peak against a neighbourhood of the held signal: the overshoot fires on
  // run boundaries, breaking edges into bright dashes.
  float mean = 0.0, wsum = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k);
    float w = exp(-fk * fk * 0.18);
    float sx = (floor((pos.x + fk * 1.5 + ph) / run) + 0.5) * run - ph;
    mean += luma(texture(u_texture, vec2(sx, rowY) / res).rgb) * w;
    wsum += w;
  }
  float lum = held + RING * (held - mean / wsum);

  // Chroma: averaged over a wide window that ignores the run structure and sits
  // left of the pixel, so colour trails the luma that made it.
  float wide = max(0.5, u_bleed) * 0.25;
  vec2 chroma = vec2(0.0);
  float bloom = 0.0, bwsum = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k);
    vec3 s = texture(u_texture, vec2(pos.x + (fk - 1.2) * wide, rowY) / res).rgb;
    chroma += chromaOf(s);
    float bw = exp(-max(0.0, fk) * 0.55) * (fk < 0.0 ? 0.25 : 1.0);
    bloom += max(0.0, luma(s) - 0.55) * bw;
    bwsum += bw;
  }
  chroma /= 9.0;
  bloom /= bwsum;

  // Dot crawl: the subcarrier beating against luma. Its phase inverts every line,
  // so the interference reads as a diagonal hatch.
  float beat = cos(6.2831853 * pos.x * 0.25 + 3.14159265 * row + u_time * 2.0);
  lum += u_crawl * length(chroma) * beat * 2.0;
  // The same beat as a demodulation phase error, which rainbows the hatch.
  float a = u_crawl * beat * 1.2;
  float ca = cos(a), sa = sin(a);
  chroma = vec2(ca * chroma.x - sa * chroma.y, sa * chroma.x + ca * chroma.y);

  // A wide chroma window averages saturation away; put it back, then crush.
  vec3 col = yiq2rgb(lum, chroma * (1.4 + u_bleed * 0.03));
  col = (col - u_crush) / max(0.05, 1.0 - u_crush);
  col = clamp(col + bloom * BLOOM, 0.0, 1.0);
  outColor = vec4(mix(src.rgb, col, u_mix), src.a);
}`,
	animated: true,
	setUniforms: floats("bleed", "crawl", "crush", "mix"),
};
