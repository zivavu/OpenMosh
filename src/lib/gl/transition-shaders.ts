/**
 * Fragment shaders for sequence segment transitions. Each blends the outgoing
 * chain output (u_texture) into the incoming one (u_texture2) along
 * u_progress (0→1). All randomness derives from (u_seed, u_progress) — never
 * u_time — so preview and export produce identical blends frame for frame.
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

/** Smooth crossfade with channel-staggered mix + a wobble that peaks mid-way. */
const DISSOLVE_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  float p = smoothstep(0.0, 1.0, u_progress);
  float spike = sin(p * 3.14159265);
  vec2 uv = v_uv;
  uv.x += sin(uv.y * 60.0 + p * 40.0) * 0.004 * spike;
  vec4 a = texture(u_texture, uv);
  vec4 b = texture(u_texture2, uv);
  vec3 col;
  col.r = mix(a.r, b.r, smoothstep(0.0, 1.0, clamp(p * 1.5, 0.0, 1.0)));
  col.g = mix(a.g, b.g, p);
  col.b = mix(a.b, b.b, smoothstep(0.0, 1.0, clamp((p - 0.25) * 1.5, 0.0, 1.0)));
  col += spike * 0.06;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Blocky noise-threshold flip with a phosphor fringe on the flipping front. */
const STATIC_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  float px = u_density == 0 ? 40.0 : (u_density == 1 ? 20.0 : 9.0);
  vec2 cell = floor(v_uv * u_resolution / px);
  float n = hash12(cell + SEED);
  float p = u_progress;
  float edge = smoothstep(0.10, 0.0, abs(n - p));
  vec2 uv = v_uv;
  uv.x += edge * (hash12(cell.yx + SEED + 11.0) - 0.5) * 0.06;
  vec4 c = n < p ? texture(u_texture2, uv) : texture(u_texture, uv);
  c.rgb += edge * 0.30 * vec3(0.4, 1.0, 0.9);
  outColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
}`;

/** Directional wipe with a jagged front and a glitched band behind it. */
const WIPE_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  float axis = u_direction == 0 ? v_uv.x
    : u_direction == 1 ? 1.0 - v_uv.x
    : u_direction == 2 ? 1.0 - v_uv.y
    : v_uv.y;
  float w = 0.18;
  float rowN = hash12(vec2(floor(axis * 90.0), SEED));
  float front = u_progress * (1.0 + w) + (rowN - 0.5) * 0.10;
  float d = axis - front;
  if (d > 0.0) {
    outColor = texture(u_texture, v_uv);
    return;
  }
  if (d < -w) {
    outColor = texture(u_texture2, v_uv);
    return;
  }
  float t = -d / w;
  float band = 1.0 - t;
  float slip = (hash12(vec2(floor(v_uv.y * 200.0), SEED + 7.0)) - 0.5) * 0.25 * band;
  vec2 uvB = v_uv + vec2(slip, 0.0);
  vec3 col;
  col.r = texture(u_texture2, uvB + vec2(0.015 * band, 0.0)).r;
  col.g = texture(u_texture2, uvB).g;
  col.b = texture(u_texture2, uvB - vec2(0.015 * band, 0.0)).b;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Grid cells flip in seeded order; fresh cells slide in with an RGB fringe. */
const BLOCKS_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  vec2 grid = u_density == 0 ? vec2(6.0, 4.0) : (u_density == 1 ? vec2(12.0, 8.0) : vec2(24.0, 14.0));
  vec2 cell = floor(v_uv * grid);
  float n = hash12(cell + SEED);
  float p = u_progress;
  if (n >= p) {
    outColor = texture(u_texture, v_uv);
    return;
  }
  float age = clamp((p - n) * 8.0, 0.0, 1.0);
  float dir = hash12(cell + SEED + 3.0) > 0.5 ? 1.0 : -1.0;
  vec2 uv = v_uv;
  uv.x += (1.0 - age) * dir * 0.08;
  vec3 col;
  col.r = texture(u_texture2, uv + vec2((1.0 - age) * 0.02, 0.0)).r;
  col.g = texture(u_texture2, uv).g;
  col.b = texture(u_texture2, uv - vec2((1.0 - age) * 0.02, 0.0)).b;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Channel-split punch: both chains shear apart in RGB and re-converge. */
const RGBSLIP_FRAG =
	H +
	HASH_GLSL +
	`void main() {
  ` +
	SEED_GLSL +
	`
  float p = u_progress;
  float s = sin(p * 3.14159265);
  vec2 uv = v_uv;
  uv.x += (hash12(vec2(floor(v_uv.y * 120.0), SEED + floor(p * 24.0))) - 0.5) * 0.05 * s;
  vec2 off = vec2(s * 0.08, 0.0);
  vec3 aCol = vec3(
    texture(u_texture, uv + off).r,
    texture(u_texture, uv).g,
    texture(u_texture, uv - off).b);
  vec3 bCol = vec3(
    texture(u_texture2, uv + off).r,
    texture(u_texture2, uv).g,
    texture(u_texture2, uv - off).b);
  float m = smoothstep(0.25, 0.75, p);
  outColor = vec4(clamp(mix(aCol, bCol, m), 0.0, 1.0), 1.0);
}`;

export const TRANSITION_SHADERS: Record<string, TransitionShaderDef> = {
	dissolve: { fragment: DISSOLVE_FRAG },
	static: { fragment: STATIC_FRAG },
	wipe: { fragment: WIPE_FRAG },
	blocks: { fragment: BLOCKS_FRAG },
	rgbslip: { fragment: RGBSLIP_FRAG },
};
