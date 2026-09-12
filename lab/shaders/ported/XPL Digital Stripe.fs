/*{
	"DESCRIPTION": "Coarse grid of random-length stripes, each shifting its cells by a random offset; some are tinted. Port of GlitchDigitalStripe — the CPU noise texture is rebuilt procedurally.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchDigitalStripe",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "intensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25 },
		{ "NAME": "frequency", "TYPE": "long", "MIN": 1, "MAX": 10, "DEFAULT": 3, "LABEL": "Frames per re-roll" },
		{ "NAME": "stripeLength", "TYPE": "float", "MIN": 0.0, "MAX": 0.99, "DEFAULT": 0.89 },
		{ "NAME": "gridWidth", "TYPE": "float", "MIN": 8.0, "MAX": 256.0, "DEFAULT": 20.0 },
		{ "NAME": "gridHeight", "TYPE": "float", "MIN": 8.0, "MAX": 256.0, "DEFAULT": 20.0 },
		{ "NAME": "stripColorAdjust", "TYPE": "bool", "DEFAULT": false },
		{ "NAME": "stripColor", "TYPE": "color", "DEFAULT": [0.1, 0.1, 0.1, 1.0] },
		{ "NAME": "stripColorIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 10.0, "DEFAULT": 2.0 }
	]
}*/

vec4 hash4(vec2 p, float seed) {
	vec4 q = vec4(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)),
	              dot(p, vec2(419.2, 371.9)), dot(p, vec2(233.7, 97.3))) + seed;
	return fract(sin(q) * 43758.5453123);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float seed = floor(float(FRAMEINDEX) / float(max(frequency, 1))) * 7.31;
	vec2 grid = vec2(gridWidth, gridHeight);
	vec2 cell = floor(uv * grid);
	// The original fills the texture in scan order, starting a new random color
	// with probability (1 - stripeLength) per cell. Walk back along the row to
	// the cell that started this run and take its color.
	vec2 start = cell;
	for (int i = 0; i < 64; i++) {
		if (start.x <= 0.0) break;
		if (hash4(start, seed + 1.7).x > stripeLength) break;
		start.x -= 1.0;
	}
	vec4 stripNoise = hash4(start, seed);
	float threshold = 1.001 - intensity * 1.001;
	float uvShift = step(threshold, pow(abs(stripNoise.x), 3.0));
	vec2 shifted = fract(uv + stripNoise.yz * uvShift);
	vec4 source = IMG_NORM_PIXEL(inputImage, shifted);
	if (!stripColorAdjust) {
		gl_FragColor = source;
		return;
	}
	float stripIntensity = step(threshold, pow(abs(stripNoise.w), 3.0)) * stripColorIntensity;
	gl_FragColor = vec4(mix(source.rgb, stripColor.rgb, clamp(stripIntensity, 0.0, 1.0)), source.a);
}
