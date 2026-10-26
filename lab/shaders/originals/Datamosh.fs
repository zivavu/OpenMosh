/*{
	"DESCRIPTION": "Codec-accurate datamosh. Each macroblock's motion is found by hierarchical block matching, then a stale picture is dragged along those vectors and the P-frame residual is added on top, so new content ghosts in as texture over the old. Blocks that can't be matched heal (intra), keyframes can be dropped or forced, held vectors bloom into streams, and chroma drifts as errors build.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Glitch", "Time", "Compression"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "keyframe", "LABEL": "Drop keyframe", "TYPE": "event" },
		{ "NAME": "keyInterval", "LABEL": "Keyframe every (s)", "TYPE": "float", "MIN": 0, "MAX": 10, "DEFAULT": 0 },
		{ "NAME": "cuts", "LABEL": "At a cut", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Drop the keyframe (mosh through)", "Keep it (clean cut)"], "DEFAULT": 0 },
		{ "NAME": "blockSize", "LABEL": "Macroblock", "TYPE": "long", "VALUES": [8, 16, 32], "LABELS": ["8 px", "16 px", "32 px"], "DEFAULT": 16 },
		{ "NAME": "search", "LABEL": "Search range (px)", "TYPE": "float", "MIN": 4, "MAX": 64, "DEFAULT": 24 },
		{ "NAME": "residual", "LABEL": "Residual kept", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.55 },
		{ "NAME": "crunch", "LABEL": "Residual crunch", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
		{ "NAME": "chromaDrift", "LABEL": "Chroma drift", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 1.2 },
		{ "NAME": "intra", "LABEL": "Healing", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.12 },
		{ "NAME": "gain", "LABEL": "Vector gain", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 1 },
		{ "NAME": "fluid", "LABEL": "Fluid vectors", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.2 },
		{ "NAME": "memory", "LABEL": "Vector memory", "TYPE": "float", "MIN": 0, "MAX": 0.98, "DEFAULT": 0.35 },
		{ "NAME": "hold", "LABEL": "Hold vectors (bloom)", "TYPE": "bool", "DEFAULT": false },
		{ "NAME": "amount", "LABEL": "Mix", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 1 }
	],
	"PASSES": [
		{ "TARGET": "lumaPrev", "PERSISTENT": true, "WIDTH": "floor($WIDTH / 2.0)", "HEIGHT": "floor($HEIGHT / 2.0)" },
		{ "TARGET": "luma", "PERSISTENT": true, "WIDTH": "floor($WIDTH / 2.0)", "HEIGHT": "floor($HEIGHT / 2.0)" },
		{ "TARGET": "mv", "PERSISTENT": true, "FLOAT": true, "FILTER": "NEAREST", "WIDTH": "max(1.0, floor($WIDTH / $blockSize))", "HEIGHT": "max(1.0, floor($HEIGHT / $blockSize))" },
		{ "TARGET": "applied", "PERSISTENT": true, "FLOAT": true, "FILTER": "NEAREST", "WIDTH": "max(1.0, floor($WIDTH / $blockSize))", "HEIGHT": "max(1.0, floor($HEIGHT / $blockSize))" },
		{ "TARGET": "scene", "PERSISTENT": true, "FLOAT": true, "FILTER": "NEAREST", "WIDTH": 1, "HEIGHT": 1 },
		{ "TARGET": "mosh", "PERSISTENT": true, "FLOAT": true },
		{ "TARGET": "prevFrame", "PERSISTENT": true },
		{ }
	]
}*/

float hash(uint s) {
	s = s * 747796405u + 2891336453u;
	uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
	return float((w >> 22u) ^ w) / 4294967295.0;
}

float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 toYCC(vec3 c) {
	return vec3(lumaOf(c), dot(c, vec3(-0.168736, -0.331264, 0.5)), dot(c, vec3(0.5, -0.418688, -0.081312)));
}
vec3 toRGB(vec3 y) {
	return vec3(y.x + 1.402 * y.z, y.x - 0.344136 * y.y - 0.714136 * y.z, y.x + 1.772 * y.y);
}

// --- Motion search (block-resolution pass) ---

vec2 blockOrigin;
vec2 blockExtent;

// Mean absolute luma difference between this block now and the previous frame displaced by v.
float sad(vec2 v) {
	float s = 0.0;
	for (int j = 0; j < 4; j++)
		for (int i = 0; i < 4; i++) {
			vec2 p = blockOrigin + (vec2(i, j) + 0.5) * 0.25 * blockExtent;
			s += abs(IMG_NORM_PIXEL(luma, p).r - IMG_NORM_PIXEL(lumaPrev, clamp(p + v, 0.0, 1.0)).r);
		}
	return s / 16.0;
}

vec2 lumaTexel;
float range;

// Rate penalty: longer vectors cost more, so flat areas settle on zero instead of jittering.
float cost(vec2 v) { return sad(v) + 0.012 * length(v / lumaTexel) / range; }

void consider(vec2 v, inout vec2 best, inout float bestCost) {
	float c = cost(v);
	if (c < bestCost) {
		bestCost = c;
		best = v;
	}
}

vec4 motionSearch() {
	vec2 blocks = RENDERSIZE;
	vec2 cell = floor(gl_FragCoord.xy);
	blockOrigin = cell / blocks;
	blockExtent = 1.0 / blocks;
	lumaTexel = 1.0 / IMG_SIZE(luma);
	range = max(search * 0.5, 1.0);

	// Predictors: zero, this block's last vector and its neighbours'.
	vec2 best = vec2(0.0);
	float bestCost = cost(best);
	ivec2 c = ivec2(cell);
	ivec2 maxc = ivec2(blocks) - 1;
	consider(texelFetch(mv, c, 0).xy, best, bestCost);
	consider(texelFetch(mv, clamp(c + ivec2(1, 0), ivec2(0), maxc), 0).xy, best, bestCost);
	consider(texelFetch(mv, clamp(c - ivec2(1, 0), ivec2(0), maxc), 0).xy, best, bestCost);
	consider(texelFetch(mv, clamp(c + ivec2(0, 1), ivec2(0), maxc), 0).xy, best, bestCost);
	consider(texelFetch(mv, clamp(c - ivec2(0, 1), ivec2(0), maxc), 0).xy, best, bestCost);

	// Coarse full grid over the search window.
	float step = range / 3.0;
	for (int j = -3; j <= 3; j++)
		for (int i = -3; i <= 3; i++)
			consider(vec2(i, j) * step * lumaTexel, best, bestCost);

	// Refine around the winner down to half a luma texel (quarter-pel at full size).
	for (int level = 0; level < 5; level++) {
		step *= 0.5;
		if (step < 0.5) break;
		vec2 centre = best;
		for (int j = -1; j <= 1; j++)
			for (int i = -1; i <= 1; i++)
				if (i != 0 || j != 0) consider(centre + vec2(i, j) * step * lumaTexel, best, bestCost);
	}
	return vec4(best, sad(best), 1.0);
}

// --- Motion compensation (full-resolution pass) ---

vec2 vectorAt(vec2 uv) {
	vec2 blocks = IMG_SIZE(applied);
	ivec2 maxc = ivec2(blocks) - 1;
	vec2 nearest = texelFetch(applied, clamp(ivec2(uv * blocks), ivec2(0), maxc), 0).xy;
	// Bilinear between block centres, like overlapped-block motion compensation.
	vec2 g = uv * blocks - 0.5;
	ivec2 i = ivec2(floor(g));
	vec2 f = fract(g);
	vec2 a = texelFetch(applied, clamp(i, ivec2(0), maxc), 0).xy;
	vec2 b = texelFetch(applied, clamp(i + ivec2(1, 0), ivec2(0), maxc), 0).xy;
	vec2 c = texelFetch(applied, clamp(i + ivec2(0, 1), ivec2(0), maxc), 0).xy;
	vec2 d = texelFetch(applied, clamp(i + ivec2(1, 1), ivec2(0), maxc), 0).xy;
	vec2 smoothV = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	return mix(nearest, smoothV, fluid);
}

// A scene cut: block error jumps everywhere at once. scene.x is this frame's mean.
bool isCut() {
	vec4 sc = texelFetch(scene, ivec2(0), 0);
	return sc.y > 0.5;
}

bool keyframeNow() {
	if (cuts == 1 && FRAMEINDEX > 3 && isCut()) return true;
	if (FRAMEINDEX < 3 || keyframe) return true;
	if (keyInterval <= 0.0) return false;
	return floor(TIME / keyInterval) != floor(max(TIME - TIMEDELTA, 0.0) / keyInterval);
}

void main() {
	vec2 uv = isf_FragNormCoord;

	if (PASSINDEX == 0) {
		gl_FragColor = IMG_NORM_PIXEL(luma, uv);
	} else if (PASSINDEX == 1) {
		// A half-res texel centre sits between four full-res pixels, so this averages them.
		gl_FragColor = vec4(lumaOf(IMG_NORM_PIXEL(inputImage, uv).rgb), 0.0, 0.0, 1.0);
	} else if (PASSINDEX == 2) {
		gl_FragColor = FRAMEINDEX < 2 ? vec4(0.0) : motionSearch();
	} else if (PASSINDEX == 3) {
		vec4 m = texelFetch(mv, ivec2(gl_FragCoord.xy), 0);
		vec2 prev = texelFetch(applied, ivec2(gl_FragCoord.xy), 0).xy;
		// Holding latches each block's strongest vector, so whatever moved keeps streaming.
		vec2 v = hold ? (dot(m.xy, m.xy) > dot(prev, prev) ? m.xy : prev) : mix(m.xy, prev, memory);
		gl_FragColor = vec4(v, 0.0, 1.0);
	} else if (PASSINDEX == 4) {
		vec2 blocksN = IMG_SIZE(mv);
		float total = 0.0;
		for (int j = 0; j < 12; j++)
			for (int i = 0; i < 16; i++)
				total += texelFetch(mv, ivec2((vec2(i, j) + 0.5) / vec2(16.0, 12.0) * blocksN), 0).z;
		float mean = total / 192.0;
		float before = texelFetch(scene, ivec2(0), 0).x;
		bool cut = FRAMEINDEX > 3 && mean > 0.06 && mean > before * 3.0 + 0.02;
		gl_FragColor = vec4(mean, cut ? 1.0 : 0.0, 0.0, 1.0);
	} else if (PASSINDEX == 5) {
		vec3 cur = IMG_NORM_PIXEL(inputImage, uv).rgb;
		if (keyframeNow()) {
			gl_FragColor = vec4(cur, 1.0);
			return;
		}
		// The cut's keyframe was deleted: nothing is decoded this frame, the old picture stays.
		if (isCut()) {
			gl_FragColor = IMG_NORM_PIXEL(mosh, uv);
			return;
		}
		vec2 blocks = IMG_SIZE(mv);
		ivec2 block = clamp(ivec2(uv * blocks), ivec2(0), ivec2(blocks) - 1);
		float err = texelFetch(mv, block, 0).z;

		// Intra blocks: the encoder gave up predicting and sent the real picture.
		uint bid = uint(block.y * 4096 + block.x) * 2654435761u + uint(FRAMEINDEX) * 7919u;
		bool intraBlock = err > mix(0.5, 0.03, intra) || hash(bid) < intra * intra * 0.02;
		if (intraBlock) {
			gl_FragColor = vec4(cur, 1.0);
			return;
		}

		vec2 v = vectorAt(uv) * gain;
		vec2 from = clamp(uv + v, 0.0, 1.0);
		vec3 predicted = IMG_NORM_PIXEL(mosh, from).rgb;
		// The residual a P-frame carries: measured against the frame the encoder really had.
		vec3 res = toYCC(cur) - toYCC(IMG_NORM_PIXEL(prevFrame, from).rgb);
		float q = mix(255.0, 7.0, crunch);
		res = floor(res * q + 0.5) / q;
		// Lost residual is lost per block, as when a macroblock is skipped or corrupt;
		// each block re-rolls on its own few-frame clock so the pattern doesn't fizz.
		uint phase = uint(hash(uint(block.x * 131 + block.y * 977)) * 4.0);
		uint epoch = (uint(FRAMEINDEX) + phase) / 4u;
		bool kept = hash(uint(block.y * 4096 + block.x) * 747796405u ^ epoch * 2891336453u) < residual;
		res *= kept ? vec3(1.0, vec2(chromaDrift)) : vec3(0.0);
		vec3 ycc = toYCC(predicted) + res;
		gl_FragColor = vec4(clamp(toRGB(ycc), 0.0, 1.0), 1.0);
	} else if (PASSINDEX == 6) {
		gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
	} else {
		vec3 cur = IMG_NORM_PIXEL(inputImage, uv).rgb;
		gl_FragColor = vec4(mix(cur, IMG_NORM_PIXEL(mosh, uv).rgb, amount), 1.0);
	}
}
