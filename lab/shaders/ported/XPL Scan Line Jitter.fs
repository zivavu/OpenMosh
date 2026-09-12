/*{
	"DESCRIPTION": "Per-scanline random horizontal (or vertical) displacement above a threshold. Port of GlitchScanLineJitter.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchScanLineJitter",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "direction", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Horizontal", "Vertical"], "DEFAULT": 0 },
		{ "NAME": "infinite", "TYPE": "bool", "DEFAULT": false, "LABEL": "Constant (no pulsing)" },
		{ "NAME": "frequency", "TYPE": "float", "MIN": 0.0, "MAX": 25.0, "DEFAULT": 1.0 },
		{ "NAME": "jitterIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3 }
	]
}*/

float randomNoise(float x, float y) {
	return fract(sin(dot(vec2(x, y), vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float strength = infinite ? 1.0 : 0.5 + 0.5 * cos(TIME * frequency);
	// C# derives displacement/threshold from the single intensity slider.
	float displacement = 0.005 + pow(jitterIntensity, 3.0) * 0.1;
	float threshold = clamp(1.0 - jitterIntensity * 1.2, 0.0, 1.0);
	// Unity _Time.x is time/20.
	float t = TIME / 20.0;
	float coord = direction == 0 ? uv.y : uv.x;
	float jitter = randomNoise(coord, t) * 2.0 - 1.0;
	jitter *= step(threshold, abs(jitter)) * displacement * strength;
	vec2 shift = direction == 0 ? vec2(jitter, 0.0) : vec2(0.0, jitter);
	gl_FragColor = IMG_NORM_PIXEL(inputImage, fract(uv + shift));
}
