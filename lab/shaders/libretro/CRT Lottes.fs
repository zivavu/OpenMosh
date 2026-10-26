/*{
	"DESCRIPTION": "Arcade-monitor CRT: the picture is resampled to a low line count with Gaussian scanlines and pixels, bent by screen curvature, softly bloomed and seen through a shadow mask. Port of Timothy Lottes' public-domain crt-lottes (libretro glsl-shaders); 'Lines' sets the emulated source resolution and 'Mask size' scales the mask for HD output.",
	"CREDIT": "Timothy Lottes — crt-lottes (port)",
	"LICENSE": "Public domain",
	"SOURCE": "https://github.com/libretro/glsl-shaders/blob/master/crt/shaders/crt-lottes.glsl",
	"CATEGORIES": ["Retro", "Texture", "Screen"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "lines", "LABEL": "Lines", "TYPE": "float", "MIN": 120, "MAX": 720, "DEFAULT": 240 },
		{ "NAME": "hardScan", "LABEL": "Scanline hardness", "TYPE": "float", "MIN": -20, "MAX": 0, "DEFAULT": -8 },
		{ "NAME": "hardPix", "LABEL": "Pixel hardness", "TYPE": "float", "MIN": -20, "MAX": 0, "DEFAULT": -3 },
		{ "NAME": "warpX", "LABEL": "Curvature X", "TYPE": "float", "MIN": 0, "MAX": 0.125, "DEFAULT": 0.031 },
		{ "NAME": "warpY", "LABEL": "Curvature Y", "TYPE": "float", "MIN": 0, "MAX": 0.125, "DEFAULT": 0.041 },
		{ "NAME": "maskDark", "LABEL": "Mask dark", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 0.5 },
		{ "NAME": "maskLight", "LABEL": "Mask light", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 1.5 },
		{ "NAME": "shadowMask", "LABEL": "Mask", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["None", "Compressed TV", "Aperture grille", "Stretched VGA", "VGA"], "DEFAULT": 3 },
		{ "NAME": "maskSize", "LABEL": "Mask size", "TYPE": "float", "MIN": 1, "MAX": 4, "DEFAULT": 1 },
		{ "NAME": "brightBoost", "LABEL": "Brightness", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 1 },
		{ "NAME": "bloomAmount", "LABEL": "Bloom", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.15 },
		{ "NAME": "shape", "LABEL": "Kernel shape", "TYPE": "float", "MIN": 0, "MAX": 10, "DEFAULT": 2 }
	]
}*/

const float hardBloomPix = -1.5;
const float hardBloomScan = -2.0;

vec2 SourceSize;

float ToLinear1(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 ToLinear(vec3 c) { return vec3(ToLinear1(c.r), ToLinear1(c.g), ToLinear1(c.b)); }
float ToSrgb1(float c) { return c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 0.41666) - 0.055; }
vec3 ToSrgb(vec3 c) { return vec3(ToSrgb1(c.r), ToSrgb1(c.g), ToSrgb1(c.b)); }

vec3 Fetch(vec2 pos, vec2 off) {
	pos = (floor(pos * SourceSize + off) + vec2(0.5)) / SourceSize;
	return ToLinear(brightBoost * clamp(IMG_NORM_PIXEL(inputImage, pos).rgb, 0.0, 1.0));
}
vec2 Dist(vec2 pos) {
	pos = pos * SourceSize;
	return -((pos - floor(pos)) - vec2(0.5));
}
float Gaus(float pos, float scale) { return exp2(scale * pow(abs(pos), shape)); }

vec3 Horz3(vec2 pos, float off) {
	vec3 b = Fetch(pos, vec2(-1.0, off));
	vec3 c = Fetch(pos, vec2(0.0, off));
	vec3 d = Fetch(pos, vec2(1.0, off));
	float dst = Dist(pos).x;
	float wb = Gaus(dst - 1.0, hardPix);
	float wc = Gaus(dst + 0.0, hardPix);
	float wd = Gaus(dst + 1.0, hardPix);
	return (b * wb + c * wc + d * wd) / (wb + wc + wd);
}
vec3 Horz5(vec2 pos, float off) {
	vec3 a = Fetch(pos, vec2(-2.0, off));
	vec3 b = Fetch(pos, vec2(-1.0, off));
	vec3 c = Fetch(pos, vec2(0.0, off));
	vec3 d = Fetch(pos, vec2(1.0, off));
	vec3 e = Fetch(pos, vec2(2.0, off));
	float dst = Dist(pos).x;
	float wa = Gaus(dst - 2.0, hardPix);
	float wb = Gaus(dst - 1.0, hardPix);
	float wc = Gaus(dst + 0.0, hardPix);
	float wd = Gaus(dst + 1.0, hardPix);
	float we = Gaus(dst + 2.0, hardPix);
	return (a * wa + b * wb + c * wc + d * wd + e * we) / (wa + wb + wc + wd + we);
}
vec3 Horz7(vec2 pos, float off) {
	vec3 a = Fetch(pos, vec2(-3.0, off));
	vec3 b = Fetch(pos, vec2(-2.0, off));
	vec3 c = Fetch(pos, vec2(-1.0, off));
	vec3 d = Fetch(pos, vec2(0.0, off));
	vec3 e = Fetch(pos, vec2(1.0, off));
	vec3 f = Fetch(pos, vec2(2.0, off));
	vec3 g = Fetch(pos, vec2(3.0, off));
	float dst = Dist(pos).x;
	float wa = Gaus(dst - 3.0, hardBloomPix);
	float wb = Gaus(dst - 2.0, hardBloomPix);
	float wc = Gaus(dst - 1.0, hardBloomPix);
	float wd = Gaus(dst + 0.0, hardBloomPix);
	float we = Gaus(dst + 1.0, hardBloomPix);
	float wf = Gaus(dst + 2.0, hardBloomPix);
	float wg = Gaus(dst + 3.0, hardBloomPix);
	return (a * wa + b * wb + c * wc + d * wd + e * we + f * wf + g * wg) / (wa + wb + wc + wd + we + wf + wg);
}
float Scan(vec2 pos, float off) { return Gaus(Dist(pos).y + off, hardScan); }
float BloomScan(vec2 pos, float off) { return Gaus(Dist(pos).y + off, hardBloomScan); }

vec3 Tri(vec2 pos) {
	vec3 a = Horz3(pos, -1.0);
	vec3 b = Horz5(pos, 0.0);
	vec3 c = Horz3(pos, 1.0);
	return a * Scan(pos, -1.0) + b * Scan(pos, 0.0) + c * Scan(pos, 1.0);
}
vec3 Bloom(vec2 pos) {
	vec3 a = Horz5(pos, -2.0);
	vec3 b = Horz7(pos, -1.0);
	vec3 c = Horz7(pos, 0.0);
	vec3 d = Horz7(pos, 1.0);
	vec3 e = Horz5(pos, 2.0);
	return a * BloomScan(pos, -2.0) + b * BloomScan(pos, -1.0) + c * BloomScan(pos, 0.0) + d * BloomScan(pos, 1.0) + e * BloomScan(pos, 2.0);
}

vec2 Warp(vec2 pos) {
	pos = pos * 2.0 - 1.0;
	pos *= vec2(1.0 + (pos.y * pos.y) * warpX, 1.0 + (pos.x * pos.x) * warpY);
	return pos * 0.5 + 0.5;
}

vec3 Mask(vec2 pos) {
	vec3 mask = vec3(maskDark);
	if (shadowMask == 1) {
		float line = maskLight;
		float odd = 0.0;
		if (fract(pos.x * 0.166666666) < 0.5) odd = 1.0;
		if (fract((pos.y + odd) * 0.5) < 0.5) line = maskDark;
		pos.x = fract(pos.x * 0.333333333);
		if (pos.x < 0.333) mask.r = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else mask.b = maskLight;
		mask *= line;
	} else if (shadowMask == 2) {
		pos.x = fract(pos.x * 0.333333333);
		if (pos.x < 0.333) mask.r = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else mask.b = maskLight;
	} else if (shadowMask == 3) {
		pos.x += pos.y * 3.0;
		pos.x = fract(pos.x * 0.166666666);
		if (pos.x < 0.333) mask.r = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else mask.b = maskLight;
	} else if (shadowMask == 4) {
		pos = floor(pos * vec2(1.0, 0.5));
		pos.x += pos.y * 3.0;
		pos.x = fract(pos.x * 0.166666666);
		if (pos.x < 0.333) mask.r = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else mask.b = maskLight;
	}
	return mask;
}

void main() {
	SourceSize = vec2(floor(lines * RENDERSIZE.x / RENDERSIZE.y), floor(lines));
	vec2 pos = Warp(isf_FragNormCoord);
	vec3 outColor = Tri(pos) + Bloom(pos) * bloomAmount;
	if (shadowMask > 0) outColor *= Mask(floor(gl_FragCoord.xy / maskSize) * 1.000001);
	if (pos.x <= 0.0001 || pos.x >= 0.9999 || pos.y <= 0.0001 || pos.y >= 0.9999) outColor = vec3(0.0);
	gl_FragColor = vec4(ToSrgb(outColor), 1.0);
}
