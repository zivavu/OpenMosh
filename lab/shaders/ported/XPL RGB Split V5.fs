/*{
	"DESCRIPTION": "Noise-driven bursts of chromatic splitting where each channel is thrown a different way. Port of GlitchRGBSplitV5 (its noise texture is replaced by smooth value noise).",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchRGBSplitV5",
	"CATEGORIES": ["Glitch", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "amplitude", "TYPE": "float", "MIN": 0.0, "MAX": 5.0, "DEFAULT": 3.0 },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 10.0, "DEFAULT": 1.0 }
	]
}*/

vec4 hash4(vec2 p) {
	vec4 q = vec4(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)),
	              dot(p, vec2(419.2, 371.9)), dot(p, vec2(233.7, 97.3)));
	return fract(sin(q) * 43758.5453123);
}
// Bilinear value noise standing in for the sampled RGBA noise texture.
vec4 noise(vec2 p) {
	p *= 64.0;
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash4(i), hash4(i + vec2(1.0, 0.0)), f.x),
	           mix(hash4(i + vec2(0.0, 1.0)), hash4(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 pow4(vec4 v, float p) {
	return vec4(pow(v.x, p), pow(v.y, p), pow(v.z, p), v.w);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	vec4 splitAmount = pow4(noise(vec2(speed * TIME, 2.0 * speed * TIME / 25.0)), 8.0) * vec4(amplitude, amplitude, amplitude, 1.0);
	splitAmount *= 2.0 * splitAmount.w - 1.0;
	float r = IMG_NORM_PIXEL(inputImage, uv + vec2(splitAmount.x, -splitAmount.y)).r;
	float g = IMG_NORM_PIXEL(inputImage, uv + vec2(splitAmount.y, -splitAmount.z)).g;
	float b = IMG_NORM_PIXEL(inputImage, uv + vec2(splitAmount.z, -splitAmount.x)).b;
	gl_FragColor = vec4(r, g, b, 1.0);
}
