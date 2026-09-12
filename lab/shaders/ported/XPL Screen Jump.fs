/*{
	"DESCRIPTION": "The whole frame rolls like a lost vertical hold. Port of GlitchScreenJump.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchScreenJump",
	"CATEGORIES": ["Glitch", "Retro", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "direction", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Horizontal", "Vertical"], "DEFAULT": 1 },
		{ "NAME": "jumpIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 5.0, "DEFAULT": 1.0 }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	float jumpTime = TIME * speed;
	if (direction == 0) {
		float jump = mix(uv.x, fract(uv.x + jumpTime), jumpIntensity);
		gl_FragColor = IMG_NORM_PIXEL(inputImage, fract(vec2(jump, uv.y)));
	} else {
		float jump = mix(uv.y, fract(uv.y + jumpTime), jumpIntensity);
		gl_FragColor = IMG_NORM_PIXEL(inputImage, fract(vec2(uv.x, jump)));
	}
}
