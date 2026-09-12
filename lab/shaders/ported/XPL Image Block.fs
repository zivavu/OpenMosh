/*{
	"DESCRIPTION": "Two layers of random block grids gate a horizontal RGB-split displacement. Port of GlitchImageBlock (V1).",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchImageBlock",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "fade", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 10.0, "DEFAULT": 1.0 },
		{ "NAME": "blockLayer1_U", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 9.0 },
		{ "NAME": "blockLayer1_V", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 9.0 },
		{ "NAME": "blockLayer2_U", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 5.0 },
		{ "NAME": "blockLayer2_V", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 5.0 },
		{ "NAME": "blockLayer1_Intensity", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 8.0 },
		{ "NAME": "blockLayer2_Intensity", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 4.0 },
		{ "NAME": "rgbSplitIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 0.5 },
		{ "NAME": "debugBlocks", "TYPE": "bool", "DEFAULT": false }
	]
}*/

float randomNoise(vec2 seed, float t) {
	return fract(sin(dot(seed * floor(t * 30.0), vec2(127.1, 311.7))) * 43758.5453123);
}
float randomNoise(float seed, float t) {
	return randomNoise(vec2(seed, 1.0), t);
}

void main() {
	float timeX = TIME * speed;
	vec2 uv = isf_FragNormCoord;
	vec2 blockLayer1 = floor(uv * vec2(blockLayer1_U, blockLayer1_V));
	vec2 blockLayer2 = floor(uv * vec2(blockLayer2_U, blockLayer2_V));
	float lineNoise1 = pow(randomNoise(blockLayer1, timeX), blockLayer1_Intensity);
	float lineNoise2 = pow(randomNoise(blockLayer2, timeX), blockLayer2_Intensity);
	float rgbSplitNoise = pow(randomNoise(5.1379, timeX), 7.1) * rgbSplitIntensity;
	float lineNoise = lineNoise1 * lineNoise2 * amount - rgbSplitNoise;
	if (debugBlocks) {
		gl_FragColor = vec4(vec3(lineNoise), 1.0);
		return;
	}
	vec4 colorR = IMG_NORM_PIXEL(inputImage, uv);
	vec4 colorG = IMG_NORM_PIXEL(inputImage, uv + vec2(lineNoise * 0.05 * randomNoise(7.0, timeX), 0.0));
	vec4 colorB = IMG_NORM_PIXEL(inputImage, uv - vec2(lineNoise * 0.05 * randomNoise(23.0, timeX), 0.0));
	vec4 result = vec4(colorR.r, colorG.g, colorB.b, colorR.a + colorG.a + colorB.a);
	gl_FragColor = mix(colorR, result, fade);
}
