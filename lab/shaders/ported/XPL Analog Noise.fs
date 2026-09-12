/*{
	"DESCRIPTION": "Per-channel streaky noise with random luminance dropouts to grayscale. Port of GlitchAnalogNoise.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchAnalogNoise",
	"CATEGORIES": ["Glitch", "Noise", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "noiseSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "noiseFading", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "luminanceJitterThreshold", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8 }
	]
}*/

float randomNoise(vec2 c) {
	return fract(sin(dot(c.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float timeX = mod(TIME, 100.0);
	vec4 sceneColor = IMG_NORM_PIXEL(inputImage, uv);
	vec4 noiseColor = sceneColor;
	float luminance = dot(noiseColor.rgb, vec3(0.22, 0.707, 0.071));
	if (randomNoise(vec2(timeX * noiseSpeed)) > luminanceJitterThreshold) {
		noiseColor = vec4(luminance);
	}
	float noiseX = randomNoise(timeX * noiseSpeed + uv / vec2(-213.0, 5.53));
	float noiseY = randomNoise(timeX * noiseSpeed - uv / vec2(213.0, -5.53));
	float noiseZ = randomNoise(timeX * noiseSpeed + uv / vec2(213.0, 5.53));
	noiseColor.rgb += 0.25 * vec3(noiseX, noiseY, noiseZ) - 0.125;
	gl_FragColor = mix(sceneColor, noiseColor, noiseFading);
}
