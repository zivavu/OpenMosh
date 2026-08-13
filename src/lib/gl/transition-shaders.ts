/**
 * Fragment shaders for sequence segment transitions. Each blends the outgoing
 * chain output (u_texture) into the incoming one (u_texture2) along
 * u_progress (0→1). All randomness derives from (u_seed, u_progress) — never
 * u_time — so preview and export produce identical blends frame for frame.
 * Flicker-style randomness quantizes progress into ticks (floor(p * N)) so it
 * re-rolls at the same output times in preview and export.
 *
 * u_direction (wipe/whip): 0=→ 1=← 2=↓ 3=↑ (in image space; v_uv.y=1 is the top).
 * u_density (blocks/shatter): 0=coarse 1=medium 2=fine.
 *
 * Scene buffers wrap MIRRORED_REPEAT and filter NEAREST, so samples past the
 * edge mirror rather than clamp, and multi-tap smears read as strobed ghosts
 * instead of soft blur. Both are deliberate.
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

/** Shared helpers. The easing curves matter as much as the effects: a
 * symmetric ramp reads as a fade, while holding and then running reads as a
 * cut with intent. */
const LIB = `float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** Barely moves for the first quarter, so the rest lands hard. */
float hold(float p) { return smoothstep(0.24, 1.0, p); }

/** Arrives fast and settles — the shape of something thrown at the camera. */
float rush(float p) { float q = 1.0 - p; return 1.0 - q * q * q * q; }

/** One spike, peaking mid-blend. */
float spike(float p) { return sin(p * 3.14159265); }

/** Channel pull along an axis. */
vec3 split(sampler2D t, vec2 uv, vec2 off) {
  return vec3(
    texture(t, uv + off).r,
    texture(t, uv).g,
    texture(t, uv - off).b);
}

/** Directional smear, centred on the sample point. */
vec3 smear(sampler2D t, vec2 uv, vec2 dir, float amt) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    acc += texture(t, uv + dir * amt * (float(i) / 9.0 - 0.5)).rgb;
  }
  return acc * 0.1;
}

/** Axis for the direction-carrying transitions. */
vec2 axisOf(int d) {
  return d == 0 ? vec2(1.0, 0.0)
    : d == 1 ? vec2(-1.0, 0.0)
    : d == 2 ? vec2(0.0, -1.0)
    : vec2(0.0, 1.0);
}
`;

const SEED_GLSL = `float SEED = mod(u_seed, 997.0);`;

export interface TransitionShaderDef {
	fragment: string;
}

function frag(body: string) {
	return `${H}${LIB}
void main() {
  ${SEED_GLSL}
${body}
}`;
}

// ── Reworked originals ─────────────────────────────────────────────────────
// Each keeps its identity and its name, so saved sequences still look like
// themselves, but gains a motion component and a curve that snaps.

/** Grain-dithered crossfade, now travelling: the two frames slide past each
 * other along a seeded axis while slices shear and the channels pull apart. */
const DISSOLVE_FRAG = frag(`  float p = u_progress;
  float e = hold(p);
  float s = spike(p);
  float tick = floor(p * 24.0);
  vec2 dir = normalize(vec2(
    hash12(vec2(SEED, 1.0)) - 0.5,
    hash12(vec2(SEED, 2.0)) - 0.5) + 0.0001);
  vec2 uvA = v_uv + dir * e * 0.11;
  vec2 uvB = v_uv - dir * (1.0 - e) * 0.11;
  float band = floor(v_uv.y * 32.0);
  float br = hash12(vec2(band, SEED + tick)) - 0.5;
  float slip = abs(br) > 0.40 ? sign(br) * (abs(br) - 0.40) * 2.2 : 0.0;
  uvA.x += slip * s;
  uvB.x += slip * s;
  float grain = hash12(floor(v_uv * u_resolution * 0.5) + SEED);
  float m = clamp(e * 1.7 - grain * 0.7, 0.0, 1.0);
  vec2 co = vec2(0.012 * s + abs(slip) * 0.15, 0.0);
  vec3 a = mix(smear(u_texture, uvA, dir, e * 0.06), split(u_texture, uvA, co), 0.5);
  vec3 b = split(u_texture2, uvB, co);
  vec3 col = mix(a, b, m);
  col *= 1.0 + (hash12(vec2(tick, SEED)) - 0.5) * 0.3 * s;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

/** Directional wipe with a jagged front. Both sides now move: the outgoing
 * frame is pushed off ahead of the front instead of waiting to be covered. */
const WIPE_FRAG = frag(`  float p = u_progress;
  float e = hold(p);
  vec2 axisVec = axisOf(u_direction);
  float a = u_direction == 0 ? v_uv.x
    : u_direction == 1 ? 1.0 - v_uv.x
    : u_direction == 2 ? 1.0 - v_uv.y
    : v_uv.y;
  float q = u_direction < 2 ? v_uv.y : v_uv.x;
  float w = 0.25;
  float rowN = hash12(vec2(floor(q * 140.0), SEED));
  float front = e * (1.0 + w + 0.16) + (rowN - 0.5) * 0.16 - 0.08;
  float d = a - front;
  if (d > 0.0) {
    // Shoved along by the front rather than standing still until it arrives.
    float pre = smoothstep(0.06, 0.0, d);
    float shove = smoothstep(0.55, 0.0, d) * e * 0.14;
    float j = (hash12(vec2(floor(q * 200.0), SEED + floor(e * 30.0))) - 0.5)
      * 0.05 * pre;
    vec2 uvA = v_uv + axisVec * (j - shove);
    outColor = vec4(clamp(smear(u_texture, uvA, axisVec, shove * 0.7), 0.0, 1.0), 1.0);
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
  outColor = vec4(clamp(split(u_texture2, uvB, co), 0.0, 1.0), 1.0);`);

/** Datamosh macroblock flip, now with the whole frame kicking as the cells
 * turn over — the compression artefact plus the camera bump that sells it. */
const BLOCKS_FRAG = frag(`  float p = u_progress;
  float e = hold(p);
  float s = spike(p);
  float tick = floor(p * 24.0);
  // A per-tick shove applied to everything, so the flip has weight behind it.
  vec2 kick = vec2(
    hash12(vec2(tick, SEED + 17.0)) - 0.5,
    hash12(vec2(tick, SEED + 23.0)) - 0.5) * 0.05 * s;
  vec2 grid = u_density == 0 ? vec2(8.0, 5.0)
    : (u_density == 1 ? vec2(14.0, 9.0) : vec2(26.0, 16.0));
  vec2 cell = floor(v_uv * grid);
  float n = hash12(cell + SEED);
  if (n >= e) {
    float soon = smoothstep(0.10, 0.0, n - e);
    vec2 uvA = v_uv + kick;
    uvA.x += (hash12(cell + SEED + tick) - 0.5) * 0.05 * soon;
    vec2 coA = vec2(0.012 * soon, 0.0);
    outColor = vec4(clamp(split(u_texture, uvA, coA), 0.0, 1.0), 1.0);
    return;
  }
  float age = clamp((e - n) * 6.0, 0.0, 1.0);
  vec2 mv = (vec2(hash12(cell + SEED + 7.0), hash12(cell + SEED + 13.0)) - 0.5)
    * 0.30 * (1.0 - age);
  vec2 uv = v_uv + mv + kick;
  float fl = hash12(cell + SEED + tick * 31.0);
  if (age < 0.7 && fl < (1.0 - age) * 0.45) {
    outColor = texture(u_texture, uv);
    return;
  }
  vec2 co = vec2(0.025 * (1.0 - age), 0.0);
  outColor = vec4(clamp(split(u_texture2, uv, co), 0.0, 1.0), 1.0);`);

/** Channel-split punch, now thrown sideways: bands shear apart while the whole
 * frame whips along the slip axis and pops in scale at the peak. */
const RGBSLIP_FRAG = frag(`  float p = u_progress;
  float s = spike(p);
  float tick = floor(p * 20.0);
  float e = hold(p);
  // Scale pop plus a lateral whip — the punch now has somewhere to go.
  float zoom = 1.0 + s * 0.14;
  vec2 uv = (v_uv - 0.5) / zoom + 0.5;
  uv.x += (e - 0.5) * 0.16;
  float band = floor(v_uv.y * 14.0);
  float bd = hash12(vec2(band, SEED)) - 0.5;
  uv.x += sign(bd) * abs(bd) * 0.20 * s * s;
  uv.x += (hash12(vec2(floor(v_uv.y * 180.0), SEED + tick)) - 0.5) * 0.05 * s;
  uv.y = fract(uv.y + (hash12(vec2(tick, SEED + 9.0)) - 0.5) * 0.06 * s * s);
  vec2 off = vec2(s * 0.11, 0.0);
  vec3 aCol = smear(u_texture, uv + off * 0.5, vec2(1.0, 0.0), s * 0.05);
  aCol = mix(aCol, split(u_texture, uv, off), 0.6);
  vec3 bCol = split(u_texture2, uv, off);
  vec3 col = mix(aCol, bCol, smoothstep(0.30, 0.70, p));
  col *= 1.0 + (hash12(vec2(tick, SEED + 4.0)) - 0.5) * 0.35 * s;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

// ── New: motion ────────────────────────────────────────────────────────────

/** The outgoing frame blows past the camera while the incoming one rushes up
 * from depth, both streaked along the radial axis. Channels arrive at slightly
 * different depths, so the rush fringes. */
const SLAM_FRAG = frag(`  float p = u_progress;
  float e = rush(p);
  float s = spike(p);
  vec2 c = vec2(0.5);
  vec2 radial = v_uv - c;
  float scaleA = 1.0 + e * 0.95;
  float scaleB = mix(0.42, 1.0, e);
  vec2 uvA = radial / scaleA + c;
  vec2 uvB = radial / scaleB + c;
  vec3 a = smear(u_texture, uvA, radial, e * 0.22);
  vec3 b = smear(u_texture2, uvB, radial, (1.0 - e) * 0.26);
  float fringe = s * 0.035;
  b.r = mix(b.r, texture(u_texture2, radial / (scaleB * (1.0 - fringe)) + c).r, 0.6);
  b.b = mix(b.b, texture(u_texture2, radial / (scaleB * (1.0 + fringe)) + c).b, 0.6);
  vec3 col = mix(a, b, smoothstep(0.32, 0.72, p));
  // Impact flash, weighted to the centre where the incoming frame lands.
  col *= 1.0 + s * s * 0.5 * (1.0 - length(radial));
  col += s * s * 0.06;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

/** A whip pan: the outgoing frame flies off one edge, the incoming one arrives
 * from the other, and the swap happens under the heaviest blur where the eye
 * can't catch it. */
const WHIP_FRAG = frag(`  float p = u_progress;
  float e = smoothstep(0.0, 1.0, p);
  float s = spike(p);
  vec2 axisVec = axisOf(u_direction);
  vec2 offA = axisVec * e * 1.25;
  vec2 offB = axisVec * (1.0 - e) * -1.25;
  float blur = s * 0.30;
  vec3 a = smear(u_texture, v_uv - offA, axisVec, blur);
  vec3 b = smear(u_texture2, v_uv - offB, axisVec, blur);
  // Chromatic trail along the pan. Samplers can't be ternary operands, so the
  // two sides are split separately and picked afterwards.
  vec2 co = axisVec * s * 0.05;
  vec3 fa = split(u_texture, v_uv - offA, co);
  vec3 fb = split(u_texture2, v_uv - offB, co);
  // Hard swap at the peak — invisible because both sides are pure streak here.
  float sw = step(0.5, p);
  vec3 col = mix(mix(a, fa, s * 0.5), mix(b, fb, s * 0.5), sw);
  col *= 1.0 + s * 0.30;
  col += (hash12(vec2(floor(p * 30.0), SEED)) - 0.5) * 0.05 * s;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

/** The frame breaks into horizontal slabs that slide out in alternating
 * directions on staggered timing, uncovering the incoming frame beneath. */
const SHATTER_FRAG = frag(`  float p = u_progress;
  float e = hold(p);
  float rows = u_density == 0 ? 6.0 : (u_density == 1 ? 12.0 : 22.0);
  float row = floor(v_uv.y * rows);
  float dir = hash12(vec2(row, SEED)) < 0.5 ? -1.0 : 1.0;
  // Each slab leaves at its own moment, so the break reads as a collapse
  // rather than a single sliding sheet.
  float lead = hash12(vec2(row, SEED + 11.0)) * 0.38;
  float t = clamp((e - lead) / max(0.0001, 1.0 - lead), 0.0, 1.0);
  float shift = dir * t * t * 1.5;
  vec2 uvA = vec2(v_uv.x - shift, v_uv.y);
  if (abs(uvA.x - 0.5) < 0.5) {
    // Slabs judder as they go and drag their channels behind them.
    float jitter = (hash12(vec2(row, SEED + floor(p * 26.0))) - 0.5) * 0.02 * t;
    vec2 co = vec2(dir * t * 0.03, 0.0);
    vec3 a = split(u_texture, uvA + vec2(0.0, jitter), co);
    a = mix(a, smear(u_texture, uvA, vec2(dir, 0.0), t * 0.06), 0.4);
    outColor = vec4(clamp(a * (1.0 - t * 0.25), 0.0, 1.0), 1.0);
    return;
  }
  // Freshly uncovered strips flash before settling.
  float fresh = smoothstep(0.0, 0.18, t - 0.5);
  outColor = vec4(clamp(texture(u_texture2, v_uv).rgb * (1.0 + fresh * 0.15), 0.0, 1.0), 1.0);`);

// ── New: time, light, and structure ────────────────────────────────────────

/** The outgoing frame freezes and stutters, each held step leaving a ghost at
 * a wider offset, and the incoming frame rises through the pile of them. */
const ECHO_FRAG = frag(`  float p = u_progress;
  float steps = 10.0;
  float tick = floor(p * steps);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  // Four generations of the same held frame, each older one further adrift.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float back = max(0.0, tick - fi);
    float age = back / steps;
    vec2 off = vec2(
      hash12(vec2(back, SEED)) - 0.5,
      hash12(vec2(back, SEED + 5.0)) - 0.5) * 0.14 * (age + 0.1);
    float w = 1.0 / (1.0 + fi * 1.5);
    vec2 co = vec2(0.02 * fi * age, 0.0);
    acc += split(u_texture, v_uv + off, co) * w;
    wsum += w;
  }
  vec3 a = acc / wsum;
  vec3 b = texture(u_texture2, v_uv).rgb;
  vec3 col = mix(a, b, smoothstep(0.42, 1.0, p));
  // Each held step drops the level a little, like a stuck frame buffer.
  col *= 1.0 + (hash12(vec2(tick, SEED + 3.0)) - 0.5) * 0.28;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

/** Exposure runs away: the frame clips to white, swings warm as it goes, and
 * falls back onto the incoming frame out of the glare. */
const BURN_FRAG = frag(`  float p = u_progress;
  float s = spike(p);
  float blow = pow(s, 1.5);
  vec2 c = vec2(0.5);
  // Light spreads as it clips, so the blowout blooms outward from centre.
  vec2 uv = (v_uv - c) / (1.0 + blow * 0.06) + c;
  vec3 a = smear(u_texture, uv, v_uv - c, blow * 0.08);
  vec3 b = smear(u_texture2, uv, v_uv - c, blow * 0.08);
  vec3 col = mix(a, b, step(0.5, p));
  col = col * (1.0 + blow * 5.5) + blow * 0.30;
  // Film burns warm before it goes: the blues clip out first.
  col *= vec3(1.0, 1.0 - blow * 0.05, 1.0 - blow * 0.16);
  float grain = hash12(floor(v_uv * u_resolution * 0.4) + SEED + floor(p * 30.0));
  col += (grain - 0.5) * 0.10 * blow;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

/** Vertical sync loss: the picture rolls off the frame with the incoming one
 * following it up, and the seam between them carries head-switching noise. */
const ROLL_FRAG = frag(`  float p = u_progress;
  float e = hold(p);
  float tick = floor(p * 40.0);
  // One continuous strip: the outgoing frame occupies [0,1], the incoming one
  // [1,2], and the whole thing scrolls by exactly one frame height.
  float src = v_uv.y + e;
  bool onB = src > 1.0;
  vec2 uv = vec2(v_uv.x, onB ? src - 1.0 : src);
  float dSeam = abs(src - 1.0);
  float seam = smoothstep(0.05, 0.0, dSeam);
  // The head can't track across the join, so rows near it tear sideways.
  uv.x += (hash12(vec2(floor(v_uv.y * u_resolution.y), SEED + tick)) - 0.5)
    * 0.30 * seam;
  vec2 co = vec2(0.02 * seam, 0.0);
  vec3 col = onB ? split(u_texture2, uv, co) : split(u_texture, uv, co);
  float n = hash12(floor(vec2(v_uv.x * u_resolution.x * 0.5,
    v_uv.y * u_resolution.y)) + SEED + tick * 7.0);
  col = mix(col, vec3(0.10 + 0.80 * n), seam * 0.85);
  col *= 1.0 - seam * 0.25;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

/** The incoming frame seeps in ordered by the outgoing frame's luminance, and
 * drips downward as it goes — the app's own pixel-sort logic, run as a wipe. */
const BLEED_FRAG = frag(`  float p = u_progress;
  float e = hold(p);
  vec3 a0 = texture(u_texture, v_uv).rgb;
  float lum = dot(a0, vec3(0.299, 0.587, 0.114));
  // Column-seeded jitter on the threshold keeps the front from being a
  // clean contour line.
  float key = lum
    + (hash12(vec2(floor(v_uv.x * u_resolution.x), SEED)) - 0.5) * 0.16;
  float m = smoothstep(key - 0.16, key + 0.16, e * 1.35);
  // Wherever it is actively opening, both sides stretch vertically.
  float drip = m * (1.0 - m) * 4.0;
  vec2 co = vec2(drip * 0.03, 0.0);
  vec3 a = smear(u_texture, v_uv - vec2(0.0, drip * 0.02), vec2(0.0, 1.0), drip * 0.05);
  vec3 b = split(u_texture2, v_uv + vec2(0.0, drip * 0.07), co);
  vec3 col = mix(a, b, m);
  col *= 1.0 + drip * 0.20;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);`);

export const TRANSITION_SHADERS: Record<string, TransitionShaderDef> = {
	dissolve: { fragment: DISSOLVE_FRAG },
	wipe: { fragment: WIPE_FRAG },
	blocks: { fragment: BLOCKS_FRAG },
	rgbslip: { fragment: RGBSLIP_FRAG },
	slam: { fragment: SLAM_FRAG },
	whip: { fragment: WHIP_FRAG },
	shatter: { fragment: SHATTER_FRAG },
	echo: { fragment: ECHO_FRAG },
	burn: { fragment: BURN_FRAG },
	roll: { fragment: ROLL_FRAG },
	bleed: { fragment: BLEED_FRAG },
};
