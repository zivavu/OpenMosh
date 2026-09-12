/**
 * Fragment shaders for sequence segment transitions. Each blends the outgoing
 * chain output (u_texture) into the incoming one (u_texture2) along
 * u_progress (0→1). All randomness derives from (u_seed, u_progress) — never
 * u_time — so preview and export produce identical blends frame for frame.
 * Flicker-style randomness quantizes progress into ticks (floor(p * N)) so it
 * re-rolls at the same output times in preview and export.
 *
 * u_direction (whip): 0=→ 1=← 2=↓ 3=↑ (in image space; v_uv.y=1 is the top).
 * u_density (shatter): 0=coarse 1=medium 2=fine.
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

/** Part of the shared prefix rather than a local in main(): the e2e suite
 * recovers each body as whatever follows the prefix common to all fragments,
 * and a SEED line there would read as every transition using the seed. */
const SEED_GLSL = `#define SEED mod(u_seed, 997.0)
`;

export interface TransitionShaderDef {
	fragment: string;
}

/** Header, helpers and one body; `helpers` are the body's own functions. */
function frag(body: string, helpers = "") {
	return `${H}${LIB}${SEED_GLSL}${helpers}
void main() {
${body}
}`;
}

// Every one of these carries a motion component and a curve that snaps — the
// soft, purely dissolving blends were dropped rather than kept as filler.

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

// Two ports from gl-transitions (MIT, via the Vidvox ISF-Files lab set). Both
// work in a y-up space with the motion along +x, so the direction handling is
// one map from screen uv into that space and its inverse for the samples.

/** Maps screen uv (y down) into the transition's y-up, rightward space. */
const ORIENT_GLSL = `vec2 toSpace(vec2 s) {
  return u_direction == 1 ? vec2(1.0 - s.x, 1.0 - s.y)
    : u_direction == 2 ? vec2(s.y, 1.0 - s.x)
    : u_direction == 3 ? vec2(1.0 - s.y, s.x)
    : vec2(s.x, 1.0 - s.y);
}
vec2 toScreen(vec2 c) {
  return u_direction == 1 ? vec2(1.0 - c.x, 1.0 - c.y)
    : u_direction == 2 ? vec2(1.0 - c.y, c.x)
    : u_direction == 3 ? vec2(c.y, 1.0 - c.x)
    : vec2(c.x, 1.0 - c.y);
}
vec4 fromColor(vec2 c) { return texture(u_texture, toScreen(c)); }
vec4 toColor(vec2 c) { return texture(u_texture2, toScreen(c)); }
`;

/** Eke Péter's crosswarp: a front sweeps across, and on either side of it the
 * outgoing frame collapses to the centre while the incoming one grows out. */
const CROSSWARP_FRAG = frag(
	`  vec2 p = toSpace(v_uv);
  // The front finishes at x=0 first, so it travels along +x like the cube.
  float x = smoothstep(0.0, 1.0, u_progress * 2.0 - p.x);
  vec4 a = fromColor((p - 0.5) * (1.0 - x) + 0.5);
  vec4 b = toColor((p - 0.5) * x + 0.5);
  outColor = vec4(mix(a, b, x).rgb, 1.0);`,
	ORIENT_GLSL,
);

/** rectalogic's cross zoom: both frames zoom-blur towards a centre that drifts
 * across the frame while dissolving into each other — the camera breathing
 * between two shots. Deliberately directionless: the blur is radially symmetric
 * about the frame centre and the drift is symmetric about it too, so a direction
 * transform would cancel out and change nothing. The lab's 40-tap loop is
 * trimmed to 24; the dithered tap offsets hide the difference, and transitions
 * render on phones too. */
const CROSSZOOM_HELPERS = `/** The original's exponential in-out dissolve: reluctant off both ends. */
float dissolveCurve(float p) {
  if (p <= 0.0) return 0.0;
  if (p >= 1.0) return 1.0;
  p *= 2.0;
  return p < 1.0
    ? 0.5 * pow(2.0, 10.0 * (p - 1.0))
    : 1.0 - 0.5 * pow(2.0, -10.0 * (p - 1.0));
}
`;

const CROSSZOOM_FRAG = frag(
	`  // The zoom centre drifts across the middle half of the frame, so the pull
  // travels instead of pulsing in place.
  vec2 center = vec2(0.25 + u_progress * 0.5, 0.5);
  float dissolve = dissolveCurve(u_progress);
  // Mirrored sinusoidal loop: the blur breathes in and back out, peaking at
  // the lab's 0.4 strength halfway through.
  float str = (1.0 - cos(u_progress * 6.2831853)) * 0.2;
  vec2 toCenter = center - v_uv;
  // Dithered taps hide the banding a short zoom-blur loop would show.
  float offset = hash12(v_uv * u_resolution);
  vec3 col = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 24; i++) {
    float percent = (float(i) + offset) / 24.0;
    float weight = 4.0 * (percent - percent * percent);
    vec2 uv = v_uv + toCenter * percent * str;
    col += mix(texture(u_texture, uv), texture(u_texture2, uv), dissolve).rgb * weight;
    total += weight;
  }
  outColor = vec4(col / total, 1.0);`,
	CROSSZOOM_HELPERS,
);

/** gre's cube: the two frames are faces of a box turning past the camera,
 * pulled back a little mid-turn and reflected off the floor beneath. */
const CUBE_HELPERS = `${ORIENT_GLSL}
const float REFLECTION = 0.4;
const float PERSP = 0.7;
const float UNZOOM = 0.3;
const float FLOATING = 3.0;

vec2 project(vec2 p) {
  return p * vec2(1.0, -1.2) + vec2(0.0, -FLOATING / 100.0);
}
bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}
vec4 bgColor(vec2 pfr, vec2 pto) {
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  pfr = project(pfr);
  if (inBounds(pfr)) c += fromColor(pfr) * REFLECTION * (1.0 - pfr.y);
  pto = project(pto);
  if (inBounds(pto)) c += toColor(pto) * REFLECTION * (1.0 - pto.y);
  return c;
}
// Skews a face into perspective about one of its vertical edges.
vec2 xskew(vec2 p, float persp, float center) {
  float x = mix(p.x, 1.0 - p.x, center);
  return (vec2(x, (p.y - 0.5 * (1.0 - persp) * x) / (1.0 + (persp - 1.0) * x))
      - vec2(0.5 - distance(center, 0.5), 0.0))
    * vec2(0.5 / distance(center, 0.5) * (center < 0.5 ? 1.0 : -1.0), 1.0)
    + vec2(center < 0.5 ? 0.0 : 1.0, 0.0);
}
`;

const CUBE_FRAG = frag(
	`  float progress = u_progress;
  vec2 op = toSpace(v_uv);
  float uz = UNZOOM * 2.0 * (0.5 - distance(0.5, progress));
  vec2 p = -uz * 0.5 + (1.0 + uz) * op;
  vec2 fromP = xskew(
    (p - vec2(progress, 0.0)) / vec2(1.0 - progress, 1.0),
    1.0 - mix(progress, 0.0, PERSP),
    0.0);
  vec2 toP = xskew(
    p / vec2(progress, 1.0),
    mix(pow(progress, 2.0), 1.0, PERSP),
    1.0);
  vec4 col = inBounds(fromP) ? fromColor(fromP)
    : inBounds(toP) ? toColor(toP)
    : bgColor(fromP, toP);
  outColor = vec4(col.rgb, 1.0);`,
	CUBE_HELPERS,
);

export const TRANSITION_SHADERS: Record<string, TransitionShaderDef> = {
	rgbslip: { fragment: RGBSLIP_FRAG },
	slam: { fragment: SLAM_FRAG },
	whip: { fragment: WHIP_FRAG },
	shatter: { fragment: SHATTER_FRAG },
	burn: { fragment: BURN_FRAG },
	crosswarp: { fragment: CROSSWARP_FRAG },
	crosszoom: { fragment: CROSSZOOM_FRAG },
	cube: { fragment: CUBE_FRAG },
};
