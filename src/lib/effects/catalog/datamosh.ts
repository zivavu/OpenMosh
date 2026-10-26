import { clockParams } from "../clock-params";
import { H, setFloat } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "datamosh",
	name: "Datamosh",
	params: [
		{
			key: "amount",
			label: "Mosh",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.6,
			moshMin: 0.35,
		},
		{
			key: "smear",
			label: "Smear",
			type: "range",
			min: 0,
			max: 3,
			step: 0.05,
			defaultValue: 1,
			moshMax: 2,
		},
		{ key: "bloom", label: "Bloom", type: "checkbox", defaultValue: 0 },
		{
			key: "cuts",
			label: "Mosh through cuts",
			type: "checkbox",
			defaultValue: 1,
		},
		...clockParams(
			"Keyframes",
			{ min: 0, max: 4, step: 0.05, defaultValue: 0, moshMax: 1 },
			"keyframe",
		),
	],
};

/* A P-frame datamosh: a stale picture is dragged along the footage's own block
 * motion, and each block adds the residual a real encoder would have sent, so new
 * content ghosts in over the old. Four chained feedback pre-passes carry the state
 * in RGBA8, since a pass only sees the one before it:
 *   frames:  r Y now, g chroma now, b Y before, a chroma before
 *   search:  rg raw vector at each block's anchor pixel; ba passed through
 *   vectors: rg held vector at the anchor, block match error one pixel right of it,
 *            and in block (0,0) the cut detector, a frame counter and a marker
 *            telling a real history from the picture a fresh buffer is seeded with
 * Chroma alternates Cb/Cr by column (4:2:2, as a codec keeps it). Vectors are whole
 * quarter-pixels of the effect frame, so zero motion stays exactly zero.
 * The blocks are only where motion is measured: vectors, match error and residual
 * loss are all interpolated or soft-masked, so no square edge reaches the picture. */

const COMMON = `uniform vec2 u_resolution;
uniform float u_amount;
uniform float u_bloom;
uniform float u_smear;
uniform float u_cuts;
uniform sampler2D u_original;
uniform sampler2D u_feedback;

const float BLOCK = 16.0;
const float SEARCH = 24.0;
const ivec2 SCENE_PX = ivec2(2, 0);
const ivec2 CLOCK_PX = ivec2(3, 0);
const float MARKER = 173.0 / 255.0;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

/** Buffer pixels per effect-frame pixel. */
float frameScale() {
  return float(textureSize(u_texture, 0).y) / u_resolution.y;
}
int blockPx() { return max(4, int(floor(BLOCK * frameScale() + 0.5))); }
ivec2 blockCount() { return max(textureSize(u_texture, 0) / blockPx(), ivec2(1)); }
ivec2 blockOf(ivec2 p) { return min(p / blockPx(), blockCount() - 1); }
ivec2 anchorOf(ivec2 block) { return block * blockPx(); }

vec2 decodeVec(vec2 enc) { return (floor(enc * 255.0 + 0.5) - 128.0) * 0.25; }
vec2 encodeVec(vec2 v) {
  return (clamp(floor(v * 4.0 + 0.5), -128.0, 127.0) + 128.0) / 255.0;
}

ivec2 clampPx(ivec2 p) { return clamp(p, ivec2(0), textureSize(u_texture, 0) - 1); }
`;

const FRAMES =
	H +
	COMMON +
	`void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(u_original, p, 0).rgb;
  float chroma = (p.x & 1) == 0
    ? dot(c, vec3(-0.168736, -0.331264, 0.5)) + 0.5
    : dot(c, vec3(0.5, -0.418688, -0.081312)) + 0.5;
  vec4 before = texelFetch(u_feedback, p, 0);
  outColor = vec4(luma(c), chroma, before.r, before.g);
}`;

const SEARCH_PASS =
	H +
	COMMON +
	`ivec2 origin;
float span;

// Mean absolute luma difference between the block now and the last frame moved by v.
float sad(vec2 v) {
  float s = 0.0;
  for (int j = 0; j < 4; j++)
    for (int i = 0; i < 4; i++) {
      ivec2 q = origin + ivec2((vec2(i, j) + 0.5) * span);
      float now = texelFetch(u_texture, clampPx(q), 0).r;
      float before = texelFetch(u_texture, clampPx(ivec2(floor(vec2(q) + v * frameScale() + 0.5))), 0).b;
      s += abs(now - before);
    }
  return s / 16.0;
}

// Longer vectors cost a little more, so flat areas settle on zero instead of jittering.
void consider(vec2 v, inout vec2 best, inout float bestCost) {
  float c = sad(v) + 0.012 * length(v) / SEARCH;
  if (c < bestCost) { bestCost = c; best = v; }
}

vec2 lastVector(ivec2 block) {
  return decodeVec(texelFetch(u_feedback, anchorOf(clamp(block, ivec2(0), blockCount() - 1)), 0).rg);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 frames = texelFetch(u_texture, p, 0);
  ivec2 block = blockOf(p);
  if (p != anchorOf(block)) {
    outColor = vec4(0.5, 0.5, frames.ba);
    return;
  }
  origin = p;
  span = float(blockPx()) / 4.0;
  vec2 best = vec2(0.0);
  float bestCost = sad(best);
  consider(lastVector(block), best, bestCost);
  consider(lastVector(block + ivec2(1, 0)), best, bestCost);
  consider(lastVector(block - ivec2(1, 0)), best, bestCost);
  consider(lastVector(block + ivec2(0, 1)), best, bestCost);
  consider(lastVector(block - ivec2(0, 1)), best, bestCost);
  float step = SEARCH / 3.0;
  for (int j = -3; j <= 3; j++)
    for (int i = -3; i <= 3; i++) consider(vec2(i, j) * step, best, bestCost);
  // Refine around the winner, down to a buffer pixel or a quarter of a frame pixel.
  float finest = max(0.25, 1.0 / frameScale());
  for (int level = 0; level < 6; level++) {
    step *= 0.5;
    if (step < finest) break;
    vec2 centre = best;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++)
        if (i != 0 || j != 0) consider(centre + vec2(i, j) * step, best, bestCost);
  }
  outColor = vec4(encodeVec(best), frames.ba);
}`;

const VECTORS_PASS =
	H +
	COMMON +
	`float zeroMotionDiff(ivec2 q) {
  return abs(luma(texelFetch(u_original, q, 0).rgb) - texelFetch(u_texture, q, 0).b);
}

float median9(float v[9]) {
  for (int i = 0; i < 5; i++)
    for (int j = i + 1; j < 9; j++)
      if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }
  return v[4];
}

// Componentwise median of the 3×3 neighbourhood: one stray vector would otherwise
// drag a lone shard of picture across the frame.
vec2 medianVector(ivec2 block) {
  float xs[9];
  float ys[9];
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 b = clamp(block + ivec2(i, j), ivec2(0), blockCount() - 1);
      vec2 v = decodeVec(texelFetch(u_texture, anchorOf(b), 0).rg);
      xs[(j + 1) * 3 + i + 1] = v.x;
      ys[(j + 1) * 3 + i + 1] = v.y;
    }
  return vec2(median9(xs), median9(ys));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 here = texelFetch(u_texture, p, 0);
  ivec2 block = blockOf(p);
  ivec2 anchor = anchorOf(block);
  bool valid = abs(texelFetch(u_feedback, CLOCK_PX, 0).g - MARKER) < 0.002;
  bool wasCut = texelFetch(u_feedback, SCENE_PX, 0).g > 0.5;

  if (p == anchor) {
    vec2 raw = medianVector(block);
    vec2 held = decodeVec(texelFetch(u_feedback, p, 0).rg);
    // Bloom latches each block's strongest motion, fading slowly, so moves keep streaming.
    vec2 v = u_bloom > 0.5
      ? (dot(raw, raw) > dot(held, held) * 0.98 ? raw : held * 0.99)
      : mix(raw, held, 0.35);
    if (!valid || wasCut) v = vec2(0.0);
    outColor = vec4(encodeVec(v), here.ba);
  } else if (p == anchor + ivec2(1, 0)) {
    vec2 raw = decodeVec(texelFetch(u_texture, anchor, 0).rg) * frameScale();
    float span = float(blockPx()) / 4.0;
    float s = 0.0;
    for (int j = 0; j < 4; j++)
      for (int i = 0; i < 4; i++) {
        ivec2 q = anchor + ivec2((vec2(i, j) + 0.5) * span);
        float now = luma(texelFetch(u_original, clampPx(q), 0).rgb);
        float before = texelFetch(u_texture, clampPx(ivec2(floor(vec2(q) + raw + 0.5))), 0).b;
        s += abs(now - before);
      }
    outColor = vec4(clamp(s / 16.0 * 4.0, 0.0, 1.0), 0.0, here.ba);
  } else if (p == SCENE_PX) {
    // A cut: the whole frame changes at once, far more than it did a frame ago.
    ivec2 size = textureSize(u_texture, 0);
    float total = 0.0;
    for (int j = 0; j < 6; j++)
      for (int i = 0; i < 8; i++)
        total += zeroMotionDiff(ivec2((vec2(i, j) + 0.5) / vec2(8.0, 6.0) * vec2(size)));
    float mean = total / 48.0;
    float before = texelFetch(u_feedback, p, 0).r;
    bool cut = valid && mean > 0.06 && mean > before * 3.0 + 0.02;
    outColor = vec4(mean, cut ? 1.0 : 0.0, here.ba);
  } else if (p == CLOCK_PX) {
    // Counts 1..255 round; 0 means this frame's history was only the seed picture.
    // Counts 1..240, a whole number of residual-mask epochs; 0 means no real history.
    float frame = valid ? mod(floor(texelFetch(u_feedback, p, 0).r * 255.0 + 0.5), 240.0) + 1.0 : 0.0;
    outColor = vec4(frame / 255.0, MARKER, here.ba);
  } else {
    outColor = vec4(0.0, 0.0, here.ba);
  }
}`;

const MOSH_PASS =
	H +
	COMMON +
	`uniform float u_delta;

float hash2(vec2 p, float seed) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seed * 0.1373);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i, seed), hash2(i + vec2(1, 0), seed), u.x),
             mix(hash2(i + vec2(0, 1), seed), hash2(i + vec2(1, 1), seed), u.x), u.y);
}

ivec2 clampBlock(ivec2 b) { return clamp(b, ivec2(0), blockCount() - 1); }

vec4 bsplineWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3,
              1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}

// A per-block field spread over the frame by a cubic B-spline: smooth to the second
// derivative, so neither the block grid nor a seam between moving and still shows.
// Side 0 is the vector at each anchor, side 1 the match error beside it.
vec2 blockField(ivec2 p, int side) {
  vec2 g = (vec2(p) + 0.5) / float(blockPx()) - 0.5;
  ivec2 i = ivec2(floor(g));
  vec4 wx = bsplineWeights(fract(g.x));
  vec4 wy = bsplineWeights(fract(g.y));
  vec2 sum = vec2(0.0);
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 4; x++) {
      vec4 t = texelFetch(u_texture, anchorOf(clampBlock(i + ivec2(x - 1, y - 1))) + ivec2(side, 0), 0);
      sum += (side == 0 ? decodeVec(t.rg) : t.rg) * wx[x] * wy[y];
    }
  return sum;
}

vec3 history(vec2 at) {
  ivec2 size = textureSize(u_feedback, 0);
  vec2 g = clamp(at, vec2(0.0), vec2(size - 1));
  ivec2 i = ivec2(floor(g));
  vec2 f = fract(g);
  ivec2 j = min(i + 1, size - 1);
  vec3 a = texelFetch(u_feedback, i, 0).rgb;
  vec3 b = texelFetch(u_feedback, ivec2(j.x, i.y), 0).rgb;
  vec3 c = texelFetch(u_feedback, ivec2(i.x, j.y), 0).rgb;
  vec3 d = texelFetch(u_feedback, j, 0).rgb;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float frameAt(ivec2 q, int channel) { return texelFetch(u_texture, clampPx(q), 0)[channel]; }

// A chroma plane lives on every other column; keep a column on its own plane at the edges.
int planeColumn(int x, int parity) {
  int last = textureSize(u_texture, 0).x - 1;
  if (x < parity) return parity;
  if (x > last) return last - ((last - parity) & 1);
  return x;
}

float planeSample(ivec2 q, int parity, bool before) {
  if (before) return texelFetch(u_texture, clampPx(q), 0).a - 0.5;
  vec3 c = texelFetch(u_original, clampPx(q), 0).rgb;
  return parity == 0 ? dot(c, vec3(-0.168736, -0.331264, 0.5)) : dot(c, vec3(0.5, -0.418688, -0.081312));
}

// Read one plane smoothly along its own grid, the same way for this frame and the
// last, so a still area's chroma residual comes out exactly zero.
float chromaAt(vec2 at, int parity, bool before) {
  float gx = (at.x - float(parity)) * 0.5;
  int cx = int(floor(gx)) * 2 + parity;
  int x0 = planeColumn(cx, parity);
  int x1 = planeColumn(cx + 2, parity);
  int cy = int(floor(at.y));
  float fx = fract(gx);
  float fy = fract(at.y);
  float top = mix(planeSample(ivec2(x0, cy), parity, before), planeSample(ivec2(x1, cy), parity, before), fx);
  float bottom = mix(planeSample(ivec2(x0, cy + 1), parity, before), planeSample(ivec2(x1, cy + 1), parity, before), fx);
  return mix(top, bottom, fy);
}

// The last frame as the encoder had it, interpolated exactly like the prediction so
// the residual carries no edge error of its own to pile up.
vec3 previousYcc(vec2 at) {
  ivec2 i = ivec2(floor(at));
  vec2 f = fract(at);
  float y = mix(mix(frameAt(i, 2), frameAt(i + ivec2(1, 0), 2), f.x),
                mix(frameAt(i + ivec2(0, 1), 2), frameAt(i + ivec2(1, 1), 2), f.x), f.y);
  return vec3(y, chromaAt(at, 0, true), chromaAt(at, 1, true));
}

vec3 currentYcc(ivec2 p) {
  vec2 at = vec2(p);
  return vec3(luma(texelFetch(u_original, p, 0).rgb), chromaAt(at, 0, false), chromaAt(at, 1, false));
}

vec3 toYcc(vec3 c) {
  return vec3(luma(c), dot(c, vec3(-0.168736, -0.331264, 0.5)), dot(c, vec3(0.5, -0.418688, -0.081312)));
}
vec3 toRgb(vec3 y) {
  return vec3(y.x + 1.402 * y.z, y.x - 0.344136 * y.y - 0.714136 * y.z, y.x + 1.772 * y.y);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 cur = texelFetch(u_original, p, 0);
  vec4 scene = texelFetch(u_texture, SCENE_PX, 0);
  uint frame = uint(floor(texelFetch(u_texture, CLOCK_PX, 0).r * 255.0 + 0.5));
  bool valid = frame > 0u;
  // Each clock cycle drops a keyframe: free-running per second, or on the beat.
  bool keyframe = u_delta > 0.0 && floor(u_time) != floor(u_time - u_delta);
  bool cut = scene.g > 0.5;
  if (!valid || keyframe || (cut && u_cuts < 0.5)) {
    outColor = cur;
    return;
  }
  // Moshing through a cut means its keyframe never arrives: nothing new is decoded.
  if (cut) {
    outColor = vec4(texelFetch(u_feedback, p, 0).rgb, cur.a);
    return;
  }

  vec2 from = vec2(p) + blockField(p, 0).xy * frameScale() * u_smear;
  vec3 predicted = history(from);
  vec3 res = currentYcc(p) - previousYcc(clamp(from, vec2(0.0), vec2(textureSize(u_texture, 0) - 1)));
  float q = mix(255.0, 7.0, mix(0.2, 0.7, u_amount));
  res = floor(res * q + 0.5) / q;
  // Residual is lost in soft patches a few blocks wide that drift from one shape to
  // the next every 8 frames. 30 shapes loop with the 240-frame counter, seamlessly.
  float e = float(frame - 1u) / 8.0;
  vec2 np = vec2(p) / (float(blockPx()) * 3.0);
  float n = mix(vnoise(np, mod(floor(e), 30.0)), vnoise(np, mod(floor(e) + 1.0, 30.0)), smoothstep(0.0, 1.0, fract(e)));
  float lost = mix(0.12, 0.78, u_amount);
  float kept = smoothstep(lost - 0.1, lost + 0.1, n);
  res *= kept * vec3(1.0, vec2(1.0 + 0.2 * u_amount));
  vec3 moshed = clamp(toRgb(toYcc(predicted) + res), 0.0, 1.0);

  // Healing: where nothing could be matched the encoder sends the real picture, faded
  // in over a smooth error field rather than block by block.
  float err = blockField(p, 1).r / 4.0;
  float threshold = mix(0.08, 0.45, u_amount);
  float heal = smoothstep(threshold * 0.6, threshold * 1.4, err);
  outColor = vec4(mix(moshed, cur.rgb, heal), cur.a);
}`;

export const shader: EffectShaderDef = {
	prePasses: [
		{ fragment: FRAMES, feedback: true },
		{ fragment: SEARCH_PASS, feedback: true },
		{ fragment: VECTORS_PASS, feedback: true },
	],
	fragment: MOSH_PASS,
	hdrFeedback: true,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_amount", v.amount as number);
		setFloat(gl, l, "u_smear", v.smear as number);
		setFloat(gl, l, "u_bloom", v.bloom as number);
		setFloat(gl, l, "u_cuts", v.cuts as number);
	},
};
