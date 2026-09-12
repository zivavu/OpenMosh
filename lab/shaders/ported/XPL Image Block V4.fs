/*{
	"DESCRIPTION": "Single block grid, displacement on both axes with an independent RGB split. Port of GlitchImageBlockV4.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchImageBlockV4",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 10.0 },
		{ "NAME": "blockSize", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 8.0 },
		{ "NAME": "maxRGBSplitX", "TYPE": "float", "MIN": 0.0, "MAX": 25.0, "DEFAULT": 1.0 },
		{ "NAME": "maxRGBSplitY", "TYPE": "float", "MIN": 0.0, "MAX": 25.0, "DEFAULT": 1.0 }
	]
}*/

float randomNoise(vec2 seed) {
	return fract(sin(dot(seed * floor(TIME * speed), vec2(17.13, 3.71))) * 43758.5453123);
}
float randomNoise(float seed) {
	return randomNoise(vec2(seed, 1.0));
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float block = randomNoise(floor(uv * blockSize));
	float displaceNoise = pow(block, 8.0) * pow(block, 3.0);
	float splitRGBNoise = pow(randomNoise(7.2341), 17.0);
	float offsetX = displaceNoise - splitRGBNoise * maxRGBSplitX;
	float offsetY = displaceNoise - splitRGBNoise * maxRGBSplitY;
	float noiseX = 0.05 * randomNoise(13.0);
	float noiseY = 0.05 * randomNoise(7.0);
	vec2 offset = vec2(offsetX * noiseX, offsetY * noiseY);
	vec4 colorR = IMG_NORM_PIXEL(inputImage, uv);
	vec4 colorG = IMG_NORM_PIXEL(inputImage, uv + offset);
	vec4 colorB = IMG_NORM_PIXEL(inputImage, uv - offset);
	gl_FragColor = vec4(colorR.r, colorG.g, colorB.b, colorR.a + colorG.a + colorB.a);
}
