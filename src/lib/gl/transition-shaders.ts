/**
 * Fragment shaders for sequence segment transitions. Each blends the outgoing
 * chain output (u_texture) into the incoming one (u_texture2) along
 * u_progress (0→1). All randomness derives from (u_seed, u_progress) — never
 * u_time — so preview and export produce identical blends frame for frame.
 * Flicker-style randomness quantizes progress into ticks (floor(p * N)) so it
 * re-rolls at the same output times in preview and export.
 *
 * u_direction (wipe): 0=→ 1=← 2=↓ 3=↑ (in image space; v_uv.y=1 is the top).
 * u_density (static/blocks): 0=coarse 1=medium 2=fine.
 */

const H = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
uniform float u_seed;
uniform int u_direction;
uniform int u_density;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;
`;

const HASH_GLSL = `float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const SEED_GLSL = `float SEED = mod(u_seed, 997.0);`;

export interface TransitionShaderDef {
	fragment: string;
}

/** Grain-dithered crossfade: pixels flip early/late per grain while slices
 * of the frame shear sideways and the RGB channels pull apart mid-blend. */
const DISSOLVE_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  float p = u_progress;
  float spike = sin(p * 3.14159265);
  float tick = floor(p * 24.0);
  vec2 uv = v_uv;
  float band = floor(v_uv.y * 32.0);
  float br = hash12(vec2(band, SEED + tick)) - 0.5;
  float slip = abs(br) > 0.40 ? sign(br) * (abs(br) - 0.40) * 2.2 : 0.0;
  uv.x += slip * spike;
  uv.x += (hash12(vec2(floor(v_uv.y * u_resolution.y), SEED + tick)) - 0.5) * 0.006 * spike;
  float grain = hash12(floor(v_uv * u_resolution * 0.5) + SEED);
  float m = clamp(p * 1.7 - grain * 0.7, 0.0, 1.0);
  vec2 co = vec2(0.012 * spike + abs(slip) * 0.15, 0.0);
  vec3 a = vec3(
    texture(u_texture, uv + co).r,
    texture(u_texture, uv).g,
    texture(u_texture, uv - co).b);
  vec3 b = vec3(
    texture(u_texture2, uv + co).r,
    texture(u_texture2, uv).g,
    texture(u_texture2, uv - co).b);
  vec3 col = mix(a, b, m);
  col *= 1.0 + (hash12(vec2(tick, SEED)) - 0.5) * 0.3 * spike;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** TV-snow wall: noise coverage ramps to near-total mid-way and clears; the
 * picture flips underneath at the peak, with scanline tears and dropouts. */
const STATIC_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  float p = u_progress;
  float cover = smoothstep(0.0, 0.35, p) * smoothstep(1.0, 0.65, p);
  float tick = floor(p * 36.0);
  float px = u_density == 0 ? 8.0 : (u_density == 1 ? 4.0 : 2.0);
  vec2 cell = floor(v_uv * u_resolution / px);
  float row = floor(v_uv.y * u_resolution.y / 4.0);
  float rr = hash12(vec2(row, SEED + tick));
  vec2 uv = v_uv;
  if (rr > 0.93) {
    uv.x += (hash12(vec2(row, SEED + tick + 51.0)) - 0.5) * 0.5 * cover;
  }
  vec3 base = (p < 0.5 ? texture(u_texture, uv) : texture(u_texture2, uv)).rgb;
  if (rr < 0.05) base *= 1.0 - 0.85 * cover;
  float n = hash12(cell + SEED + tick * 13.0);
  if (n < cover * 0.97) {
    float snow = hash12(cell + SEED + tick * 29.0 + 7.0);
    base = vec3(0.12 + 0.83 * snow);
  }
  outColor = vec4(clamp(base, 0.0, 1.0), 1.0);
}`;

/** Directional wipe with a jagged front: incoming pixels smear-streak in from
 * the leading edge with slice slips and RGB fringing; rows just ahead of the
 * front twitch before being consumed. */
const WIPE_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  float a = u_direction == 0 ? v_uv.x
    : u_direction == 1 ? 1.0 - v_uv.x
    : u_direction == 2 ? 1.0 - v_uv.y
    : v_uv.y;
  float q = u_direction < 2 ? v_uv.y : v_uv.x;
  vec2 axisVec = u_direction == 0 ? vec2(1.0, 0.0)
    : u_direction == 1 ? vec2(-1.0, 0.0)
    : u_direction == 2 ? vec2(0.0, -1.0)
    : vec2(0.0, 1.0);
  float w = 0.25;
  float rowN = hash12(vec2(floor(q * 140.0), SEED));
  float front = u_progress * (1.0 + w + 0.16) + (rowN - 0.5) * 0.16 - 0.08;
  float d = a - front;
  if (d > 0.0) {
    float pre = smoothstep(0.06, 0.0, d);
    float j = (hash12(vec2(floor(q * 200.0), SEED + floor(u_progress * 30.0))) - 0.5)
      * 0.05 * pre;
    outColor = texture(u_texture, v_uv + axisVec * j);
    return;
  }
  if (d < -w) {
    outColor = texture(u_texture2, v_uv);
    return;
  }
  float band = 1.0 + d / w;
  float pull = band * band * (0.4 + 0.6 * hash12(vec2(floor(q * 140.0), SEED + 3.0)));
  float aB = mix(a, front, pull);
  vec2 uvB = u_direction == 0 ? vec2(aB, q)
    : u_direction == 1 ? vec2(1.0 - aB, q)
    : u_direction == 2 ? vec2(q, 1.0 - aB)
    : vec2(q, aB);
  uvB += axisVec * (hash12(vec2(floor(q * 200.0), SEED + 7.0)) - 0.5) * 0.3 * band;
  vec2 co = axisVec * 0.02 * band;
  vec3 col = vec3(
    texture(u_texture2, uvB + co).r,
    texture(u_texture2, uvB).g,
    texture(u_texture2, uvB - co).b);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Datamosh-style macroblock flip: cells about to flip twitch in place, fresh
 * cells pull content from the wrong place (broken motion vectors) with a hard
 * RGB split and occasionally flicker back to the outgoing frame. */
const BLOCKS_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  vec2 grid = u_density == 0 ? vec2(8.0, 5.0) : (u_density == 1 ? vec2(14.0, 9.0) : vec2(26.0, 16.0));
  vec2 cell = floor(v_uv * grid);
  float n = hash12(cell + SEED);
  float p = u_progress;
  float tick = floor(p * 24.0);
  if (n >= p) {
    float soon = smoothstep(0.10, 0.0, n - p);
    vec2 uvA = v_uv;
    uvA.x += (hash12(cell + SEED + tick) - 0.5) * 0.05 * soon;
    vec2 coA = vec2(0.012 * soon, 0.0);
    vec3 colA = vec3(
      texture(u_texture, uvA + coA).r,
      texture(u_texture, uvA).g,
      texture(u_texture, uvA - coA).b);
    outColor = vec4(clamp(colA, 0.0, 1.0), 1.0);
    return;
  }
  float age = clamp((p - n) * 6.0, 0.0, 1.0);
  vec2 mv = (vec2(hash12(cell + SEED + 7.0), hash12(cell + SEED + 13.0)) - 0.5)
    * 0.30 * (1.0 - age);
  vec2 uv = v_uv + mv;
  float fl = hash12(cell + SEED + tick * 31.0);
  if (age < 0.7 && fl < (1.0 - age) * 0.45) {
    outColor = texture(u_texture, uv);
    return;
  }
  vec2 co = vec2(0.025 * (1.0 - age), 0.0);
  vec3 col = vec3(
    texture(u_texture2, uv + co).r,
    texture(u_texture2, uv).g,
    texture(u_texture2, uv - co).b);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Channel-split punch: bands shear apart, the RGB channels pull wide, a
 * brief sync-roll and hot flicker hit at the peak, then everything
 * re-converges on the incoming chain. */
const RGBSLIP_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  float p = u_progress;
  float s = sin(p * 3.14159265);
  float tick = floor(p * 20.0);
  vec2 uv = v_uv;
  float band = floor(v_uv.y * 14.0);
  float bd = hash12(vec2(band, SEED)) - 0.5;
  uv.x += sign(bd) * abs(bd) * 0.20 * s * s;
  uv.x += (hash12(vec2(floor(v_uv.y * 180.0), SEED + tick)) - 0.5) * 0.05 * s;
  uv.y = fract(uv.y + (hash12(vec2(tick, SEED + 9.0)) - 0.5) * 0.06 * s * s);
  vec2 off = vec2(s * 0.11, 0.0);
  vec3 aCol = vec3(
    texture(u_texture, uv + off).r,
    texture(u_texture, uv).g,
    texture(u_texture, uv - off).b);
  vec3 bCol = vec3(
    texture(u_texture2, uv + off).r,
    texture(u_texture2, uv).g,
    texture(u_texture2, uv - off).b);
  float m = smoothstep(0.30, 0.70, p);
  vec3 col = mix(aCol, bCol, m);
  col *= 1.0 + (hash12(vec2(tick, SEED + 4.0)) - 0.5) * 0.35 * s;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export const TRANSITION_SHADERS: Record<string, TransitionShaderDef> = {
	dissolve: { fragment: DISSOLVE_FRAG },
	static: { fragment: STATIC_FRAG },
	wipe: { fragment: WIPE_FRAG },
	blocks: { fragment: BLOCKS_FRAG },
	rgbslip: { fragment: RGBSLIP_FRAG },
};
