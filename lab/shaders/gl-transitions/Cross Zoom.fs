/*{
	"DESCRIPTION": "Zoom-blur crossfade: both images blur towards a moving center while dissolving. Port of gl-transitions CrossZoom.",
	"CREDIT": "rectalogic — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/CrossZoom.glsl",
	"CATEGORIES": ["Transition", "Blur"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "strength", "LABEL": "Strength", "TYPE": "float", "MIN": 0.1, "MAX": 1, "DEFAULT": 0.4 }
	]
}*/

const float PI = 3.141592653589793;

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

float Linear_ease(float begin, float change, float duration, float time) {
	return change * time / duration + begin;
}
float Exponential_easeInOut(float begin, float change, float duration, float time) {
	if (time == 0.0) return begin;
	if (time == duration) return begin + change;
	time = time / (duration / 2.0);
	if (time < 1.0) return change / 2.0 * pow(2.0, 10.0 * (time - 1.0)) + begin;
	return change / 2.0 * (-pow(2.0, -10.0 * (time - 1.0)) + 2.0) + begin;
}
float Sinusoidal_easeInOut(float begin, float change, float duration, float time) {
	return -change / 2.0 * (cos(PI * time / duration) - 1.0) + begin;
}
float rand(vec2 co) {
	return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
vec4 crossFade(vec2 uv, float dissolve) {
	return mix(getFromColor(uv), getToColor(uv), dissolve);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 center = vec2(Linear_ease(0.25, 0.5, 1.0, progress), 0.5);
	float dissolve = Exponential_easeInOut(0.0, 1.0, 1.0, progress);
	float str = Sinusoidal_easeInOut(0.0, strength, 0.5, progress);

	vec4 color = vec4(0.0);
	float total = 0.0;
	vec2 toCenter = center - uv;
	float offset = rand(uv);

	for (float t = 0.0; t <= 40.0; t++) {
		float percent = (t + offset) / 40.0;
		float weight = 4.0 * (percent - percent * percent);
		color += crossFade(uv + toCenter * percent * str, dissolve) * weight;
		total += weight;
	}
	gl_FragColor = color / total;
}
