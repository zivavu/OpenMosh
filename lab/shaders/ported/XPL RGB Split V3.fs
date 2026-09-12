/*{
	"DESCRIPTION": "Slow sinusoidal red/green channel drift along an axis or the diagonal. Port of GlitchRGBSplitV3.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchRGBSplitV3",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "direction", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["Horizontal", "Vertical", "Both"], "DEFAULT": 0 },
		{ "NAME": "infinite", "TYPE": "bool", "DEFAULT": false, "LABEL": "Constant (no pulsing)" },
		{ "NAME": "frequency", "TYPE": "float", "MIN": 0.0, "MAX": 25.0, "DEFAULT": 1.0 },
		{ "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 200.0, "DEFAULT": 30.0 },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 10.0, "DEFAULT": 10.0 }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	float strength = infinite ? 1.0 : 0.5 + 0.5 * cos(TIME * frequency);
	float a = amount * strength * 0.001;
	float t = TIME * speed;
	float sr = sin(t * 0.2) * a;
	float sg = sin(t * 0.1) * a;
	vec3 c;
	if (direction == 0) {
		c.r = IMG_NORM_PIXEL(inputImage, vec2(uv.x + sr, uv.y)).r;
		c.g = IMG_NORM_PIXEL(inputImage, vec2(uv.x + sg, uv.y)).g;
		c.b = IMG_NORM_PIXEL(inputImage, uv).b;
	} else if (direction == 1) {
		c.r = IMG_NORM_PIXEL(inputImage, vec2(uv.x, uv.y + sr)).r;
		c.g = IMG_NORM_PIXEL(inputImage, vec2(uv.x, uv.y + sg)).g;
		c.b = IMG_NORM_PIXEL(inputImage, uv).b;
	} else {
		c.r = IMG_NORM_PIXEL(inputImage, uv + vec2(sr)).r;
		c.g = IMG_NORM_PIXEL(inputImage, uv).g;
		c.b = IMG_NORM_PIXEL(inputImage, uv + vec2(sg)).b;
	}
	gl_FragColor = vec4(c, 1.0);
}
