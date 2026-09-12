/*{
	"DESCRIPTION": "Trigger-style glitch: skewed luminance-threshold blocks with per-grid random seeds and a hue shift. Port of FlashGlitch; the manual triggers were replaced with a self-retriggering pulse (rate + release).",
	"CREDIT": "Keijiro Takahashi — FlashGlitch (port)",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/FlashGlitch",
	"CATEGORIES": ["Glitch", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "strength", "LABEL": "Strength", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.6 },
		{ "NAME": "rate", "LABEL": "Rate (Hz)", "TYPE": "float", "MIN": 0, "MAX": 20, "DEFAULT": 4 },
		{ "NAME": "release", "LABEL": "Release (s)", "TYPE": "float", "MIN": 0.05, "MAX": 2, "DEFAULT": 0.5 },
		{ "NAME": "hue", "LABEL": "Hue shift", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 }
	]
}*/

float Hash(uint s) {
	s = s * 747796405u + 2891336453u;
	uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
	return float((w >> 22u) ^ w) / 4294967295.0;
}
vec4 Hash4(uint seed) {
	seed *= 4u;
	return vec4(Hash(seed), Hash(seed + 1u), Hash(seed + 2u), Hash(seed + 3u));
}

// 2D simplex noise (Ashima, as used by keijiro/NoiseShader).
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute3(vec3 x) { return mod289v3(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
	const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
	vec2 i = floor(v + dot(v, C.yy));
	vec2 x0 = v - i + dot(i, C.xx);
	vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
	vec4 x12 = x0.xyxy + C.xxzz;
	x12.xy -= i1;
	i = mod289v2(i);
	vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
	vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
	m = m * m;
	m = m * m;
	vec3 x = 2.0 * fract(p * C.www) - 1.0;
	vec3 h = abs(x) - 0.5;
	vec3 ox = floor(x + 0.5);
	vec3 a0 = x - ox;
	m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
	vec3 g;
	g.x = a0.x * x0.x + h.x * x0.y;
	g.yz = a0.yz * x12.xz + h.yz * x12.yw;
	return 130.0 * dot(m, g);
}

vec3 RgbToHsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 HsvToRgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec4 FG_GridRandom(vec2 uv, uint seed) {
	const float cells = 32.0;
	float aspect = RENDERSIZE.x / RENDERSIZE.y;
	vec2 grid = floor(uv * vec2(aspect, 1.0) * cells) / cells;
	vec2 npos = grid * vec2(0.075, 2.0) + float(seed & 0xffu);
	uint offs = uint((snoise(npos) + 2.0) * 4.0);
	return Hash4(seed + offs);
}
vec2 FG_SkewUV(vec2 uv, float rand) {
	float skew = (rand - 0.5) * 2.0;
	float skew7 = skew * skew * skew * skew * skew * skew * skew;
	return vec2(uv.y * skew7 * 8.0, 0.0);
}
vec2 FG_Displace(vec2 uv, uint seed) {
	float d = Hash(uint(uv.y * 6.0) + seed) * 2.0 - 1.0;
	float d5 = d * d * d * d * d;
	return vec2(uv.x + d5 * 0.5, uv.y);
}
vec3 FG_ApplyHue(vec3 color, float shift) {
	vec3 hsv = RgbToHsv(clamp(color, 0.0, 1.0));
	hsv.x = fract(hsv.x + shift);
	return HsvToRgb(hsv);
}
float FG_SampleGlitch(vec2 uv, float threshold, vec4 rand) {
	vec2 skew = FG_SkewUV(uv, rand.z);
	vec2 uv2 = fract(uv + rand.xy + skew);
	vec3 src = IMG_NORM_PIXEL(inputImage, uv2).rgb;
	float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
	return step(threshold + rand.w, l);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	uint seed = uint(floor(TIME * rate)) * 7919u + 1u;

	// Two trigger channels re-fired at `rate`, each decaying over `release`.
	float curve = 0.15 + (1.0 - (1.0 - strength) * (1.0 - strength));
	float r = max(rate, 1e-4);
	float age1 = rate < 0.01 ? 0.0 : fract(TIME * rate) / r;
	float age2 = rate < 0.01 ? 0.0 : fract(TIME * rate + 0.5) / r;
	float p1 = max(0.0, curve - age1 / release);
	float p2 = max(0.0, curve - age2 / release);

	float threshold1 = 1.0 - max(p1, p2);
	float threshold2 = 1.0 - p2;

	vec2 uv2 = FG_Displace(uv, seed ^ 0x38f7cu);
	vec4 rand1 = FG_GridRandom(uv, seed ^ 0x1beefu);
	vec4 rand2 = FG_GridRandom(uv2, seed ^ 0x1beefu);
	float s1 = FG_SampleGlitch(uv, threshold1, rand1);
	float s2 = FG_SampleGlitch(uv2, threshold2, rand2);

	float alpha = max(s1, s2);
	vec3 color = FG_ApplyHue(vec3(s1, s2, s2), hue);
	vec3 src = IMG_NORM_PIXEL(inputImage, uv).rgb;
	gl_FragColor = vec4(mix(src, color, alpha), 1.0);
}
