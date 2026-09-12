/*{
	"DESCRIPTION": "Downscale, then ordered dithering (Bayer 2/4/8 or interleaved-gradient noise) into a per-channel reduced palette, in RGB or HSL. Port of AcerolaFX_Dither; the blue-noise textures are replaced by interleaved gradient noise.",
	"CREDIT": "Garrett Gunnell (Acerola) — AcerolaFX (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/GarrettGunnell/AcerolaFX/blob/main/Shaders/AcerolaFX_Dither.fx",
	"CATEGORIES": ["Stylize", "Retro", "Acerola"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "downscale", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["1x", "1/2", "1/4", "1/8", "1/16"], "DEFAULT": 1 },
		{ "NAME": "noiseMode", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["Bayer 2x2", "Bayer 4x4", "Bayer 8x8", "Gradient noise"], "DEFAULT": 2 },
		{ "NAME": "animateNoise", "TYPE": "bool", "DEFAULT": false },
		{ "NAME": "animationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "spread", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "colorSpace", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["RGB", "HSL"], "DEFAULT": 0 },
		{ "NAME": "redColorCount", "TYPE": "long", "MIN": 2, "MAX": 16, "DEFAULT": 2 },
		{ "NAME": "greenColorCount", "TYPE": "long", "MIN": 2, "MAX": 16, "DEFAULT": 2 },
		{ "NAME": "blueColorCount", "TYPE": "long", "MIN": 2, "MAX": 16, "DEFAULT": 2 }
	],
	"PASSES": [
		{ "TARGET": "small", "WIDTH": "floor($WIDTH / pow(2.0, $downscale))", "HEIGHT": "floor($HEIGHT / pow(2.0, $downscale))", "FILTER": "NEAREST" },
		{}
	]
}*/

#define saturate(x) clamp((x), 0.0, 1.0)

const int bayer2[4] = int[4](0, 2, 3, 1);
const int bayer4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
const int bayer8[64] = int[64](
	0, 32, 8, 40, 2, 34, 10, 42,
	48, 16, 56, 24, 50, 18, 58, 26,
	12, 44, 4, 36, 14, 46, 6, 38,
	60, 28, 52, 20, 62, 30, 54, 22,
	3, 35, 11, 43, 1, 33, 9, 41,
	51, 19, 59, 27, 49, 17, 57, 25,
	15, 47, 7, 39, 13, 45, 5, 37,
	63, 31, 55, 23, 61, 29, 53, 21);

float getBayer2(int x, int y) { return float(bayer2[(x % 2) + (y % 2) * 2]) * (1.0 / 4.0) - 0.5; }
float getBayer4(int x, int y) { return float(bayer4[(x % 4) + (y % 4) * 4]) * (1.0 / 16.0) - 0.5; }
float getBayer8(int x, int y) { return float(bayer8[(x % 8) + (y % 8) * 8]) * (1.0 / 64.0) - 0.5; }

// Jimenez interleaved gradient noise — stands in for the blue-noise textures.
float ign(vec2 p) {
	return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)) - 0.5;
}

vec3 rgb2hcv(vec3 RGB) {
	vec4 P = (RGB.g < RGB.b) ? vec4(RGB.bg, -1.0, 2.0 / 3.0) : vec4(RGB.gb, 0.0, -1.0 / 3.0);
	vec4 Q = (RGB.r < P.x) ? vec4(P.xyw, RGB.r) : vec4(RGB.r, P.yzx);
	float C = Q.x - min(Q.w, Q.y);
	float H = abs((Q.w - Q.y) / (6.0 * C + 1e-10) + Q.z);
	return vec3(H, C, Q.x);
}
vec3 rgb2hsl(vec3 RGB) {
	vec3 HCV = rgb2hcv(RGB);
	float L = HCV.z - HCV.y * 0.5;
	float S = HCV.y / (1.0 - abs(L * 2.0 - 1.0) + 1e-10);
	return vec3(HCV.x, S, L);
}
vec3 hue2rgb(float H) {
	float R = abs(H * 6.0 - 3.0) - 1.0;
	float G = 2.0 - abs(H * 6.0 - 2.0);
	float B = 2.0 - abs(H * 6.0 - 4.0);
	return saturate(vec3(R, G, B));
}
vec3 hsl2rgb(vec3 HSL) {
	vec3 RGB = hue2rgb(HSL.x);
	float C = (1.0 - abs(2.0 * HSL.z - 1.0)) * HSL.y;
	return (RGB - 0.5) * C + HSL.z;
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (PASSINDEX == 0) {
		gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
		return;
	}
	vec4 col = IMG_NORM_PIXEL(small, uv);
	vec2 smallSize = IMG_SIZE(small);
	int x = int(uv.x * smallSize.x);
	int y = int(uv.y * smallSize.y);
	int mode = noiseMode;
	if (animateNoise) {
		int tick = int(floor(TIME / (1.001 - animationSpeed)));
		mode = noiseMode == 3 ? 3 : tick % 3;
	}
	float noise = 0.0;
	if (mode == 0) noise = getBayer2(x, y);
	else if (mode == 1) noise = getBayer4(x, y);
	else if (mode == 2) noise = getBayer8(x, y);
	else noise = ign(vec2(x, y) + (animateNoise ? floor(TIME * 60.0 * animationSpeed) * vec2(5.588238, 3.2) : vec2(0.0)));
	vec4 output = saturate(col) + spread * noise;
	if (colorSpace == 1) {
		output.rgb = rgb2hsl(output.rgb - spread * noise) + spread * noise;
	}
	output.r = floor((float(redColorCount) - 1.0) * output.r + 0.5) / (float(redColorCount) - 1.0);
	output.g = floor((float(greenColorCount) - 1.0) * output.g + 0.5) / (float(greenColorCount) - 1.0);
	output.b = floor((float(blueColorCount) - 1.0) * output.b + 0.5) / (float(blueColorCount) - 1.0);
	if (colorSpace == 1) {
		output.gb = saturate(output.gb);
		output.rgb = hsl2rgb(output.rgb);
	}
	gl_FragColor = vec4(saturate(output.rgb), 1.0);
}
