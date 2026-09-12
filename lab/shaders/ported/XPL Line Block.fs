/*{
	"DESCRIPTION": "Horizontal or vertical bands tear sideways with a YUV chroma push. Port of GlitchLineBlock.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchLineBlock",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "direction", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Horizontal", "Vertical"], "DEFAULT": 0 },
		{ "NAME": "infinite", "TYPE": "bool", "DEFAULT": false, "LABEL": "Constant (no pulsing)" },
		{ "NAME": "frequency", "TYPE": "float", "MIN": 0.0, "MAX": 25.0, "DEFAULT": 1.0 },
		{ "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "linesWidth", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 1.0 },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8 },
		{ "NAME": "offset", "TYPE": "float", "MIN": 0.0, "MAX": 13.0, "DEFAULT": 1.0 },
		{ "NAME": "alpha", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
	]
}*/

#define saturate(x) clamp((x), 0.0, 1.0)

float randomNoise(vec2 c) {
	return fract(sin(dot(c.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
float truncf(float x, float num_levels) {
	return floor(x * num_levels) / num_levels;
}
vec2 truncv(vec2 x, vec2 num_levels) {
	return floor(x * num_levels) / num_levels;
}
vec3 rgb2yuv(vec3 rgb) {
	return vec3(dot(rgb, vec3(0.299, 0.587, 0.114)),
	            dot(rgb, vec3(-0.14713, -0.28886, 0.436)),
	            dot(rgb, vec3(0.615, -0.51499, -0.10001)));
}
vec3 yuv2rgb(vec3 yuv) {
	return vec3(yuv.x + yuv.z * 1.13983,
	            yuv.x + dot(vec2(-0.39465, -0.58060), yuv.yz),
	            yuv.x + yuv.y * 2.03211);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	// The C# side feeds TimeX * speed * 0.2 as the shader's time.
	float timeX = TIME * speed * 0.2;
	float strength = infinite ? 10.0 : 0.5 + 0.5 * cos(TIME * frequency);
	timeX *= strength;
	// Bands run along the chosen axis.
	vec2 axis = direction == 0 ? uv.yy : uv.xx;
	float truncTime = truncf(timeX, 4.0);
	float uv_trunc = randomNoise(truncv(axis, vec2(8.0, 8.0)) + 100.0 * truncTime);
	float uv_randomTrunc = 6.0 * truncf(timeX, 24.0 * uv_trunc);
	float invWidth = 1.0 / linesWidth;
	float blockLine_random = 0.5 * randomNoise(truncv(axis + uv_randomTrunc, vec2(8.0 * invWidth)));
	blockLine_random += 0.5 * randomNoise(truncv(axis + uv_randomTrunc, vec2(7.0, 7.0)));
	blockLine_random = blockLine_random * 2.0 - 1.0;
	blockLine_random = sign(blockLine_random) * saturate((abs(blockLine_random) - amount) / 0.4);
	blockLine_random = mix(0.0, blockLine_random, offset);
	vec2 shift = direction == 0 ? vec2(0.1 * blockLine_random, 0.0) : vec2(0.0, 0.1 * blockLine_random);
	vec2 uv_blockLine = saturate(uv + shift);
	vec4 blockLineColor = IMG_NORM_PIXEL(inputImage, abs(uv_blockLine));
	vec3 yuv = rgb2yuv(blockLineColor.rgb);
	yuv.y /= 1.0 - 3.0 * abs(blockLine_random) * saturate(0.5 - blockLine_random);
	yuv.z += 0.125 * blockLine_random * saturate(blockLine_random - 0.5);
	vec4 sceneColor = IMG_NORM_PIXEL(inputImage, uv);
	gl_FragColor = mix(sceneColor, vec4(yuv2rgb(yuv), blockLineColor.a), alpha);
}
