/*{
	"DESCRIPTION": "Every other strip of the image oscillates by a pixel amount. Port of GlitchTileJitter.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchTileJitter",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "splittingDirection", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Horizontal strips", "Vertical strips"], "DEFAULT": 1 },
		{ "NAME": "jitterDirection", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Jitter X", "Jitter Y"], "DEFAULT": 0 },
		{ "NAME": "infinite", "TYPE": "bool", "DEFAULT": false, "LABEL": "Constant (no pulsing)" },
		{ "NAME": "frequency", "TYPE": "float", "MIN": 0.0, "MAX": 25.0, "DEFAULT": 1.0 },
		{ "NAME": "splittingNumber", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 5.0 },
		{ "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 100.0, "DEFAULT": 10.0 },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35 }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	float strength = infinite ? 1.0 : 0.5 + 0.5 * cos(TIME * frequency);
	float pixelSizeX = 1.0 / RENDERSIZE.x;
	float jitterSpeed = speed * 100.0;
	float coord = splittingDirection == 1 ? uv.x : uv.y;
	if (mod(coord * splittingNumber, 2.0) < 1.0) {
		float d = pixelSizeX * cos(TIME * jitterSpeed) * amount * strength;
		if (jitterDirection == 0) uv.x += d;
		else uv.y += d;
	}
	gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
}
