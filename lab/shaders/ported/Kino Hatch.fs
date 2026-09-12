/*{
	"DESCRIPTION": "Monochrome pen hatching: two diagonal stroke families whose thickness follows luminance, with noise-wavered lines. Port of KinoHatch.",
	"CREDIT": "Keijiro Takahashi — KinoHatch (port); simplex noise by Ashima Arts / Stefan Gustavson",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/KinoHatch",
	"CATEGORIES": ["Stylize", "Drawing", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "repeat", "TYPE": "float", "MIN": 10.0, "MAX": 400.0, "DEFAULT": 120.0 },
		{ "NAME": "waviness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3 },
		{ "NAME": "displacement", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5 },
		{ "NAME": "thickness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "seed", "TYPE": "float", "MIN": 0.0, "MAX": 100.0, "DEFAULT": 0.0 },
		{ "NAME": "opacity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
	]
}*/

#define saturate(x) clamp((x), 0.0, 1.0)

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
	const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
	vec2 i = floor(v + dot(v, C.yy));
	vec2 x0 = v - i + dot(i, C.xx);
	vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
	vec4 x12 = x0.xyxy + C.xxzz;
	x12.xy -= i1;
	i = mod289(i);
	vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
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

float range01(float x, float a, float b) {
	return saturate((x - a) / (b - a));
}

float hatching(vec2 uv, vec2 dir, float thresh) {
	float p1 = dot(uv, dir) * repeat;
	vec2 nsp = vec2(dot(uv, dir.xy * vec2(1.0, -1.0)), floor(p1) * 11.4729 / repeat + seed);
	float disp = snoise(nsp * repeat * waviness * 2.0);
	disp *= 0.2 * displacement / repeat;
	float p2 = dot(uv + dir * disp, dir) * repeat;
	float d = abs(1.0 - 2.0 * fract(p2));
	return saturate((thresh - thickness + d) * 400.0 / repeat);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	// Keep strokes square on non-square frames.
	vec2 huv = vec2(uv.x * RENDERSIZE.x / RENDERSIZE.y, uv.y);
	vec4 src = IMG_NORM_PIXEL(inputImage, uv);
	float lm = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
	float bw1 = hatching(huv, vec2(1.0, 1.0), range01(lm, 0.4, 1.0));
	float bw2 = hatching(huv, vec2(1.0, -1.0), range01(lm, 0.1, 0.7));
	src.rgb = mix(src.rgb, vec3(min(bw1, bw2)), opacity);
	gl_FragColor = src;
}
