/*{
	"DESCRIPTION": "Overexposure flash: both images blow out towards white mid-transition, like a camera flash between shots. Port of gl-transitions Overexposure.",
	"CREDIT": "Ben Zhang — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Overexposure.glsl",
	"CATEGORIES": ["Transition", "Light"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "strength", "LABEL": "Strength", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 0.6 }
	]
}*/

const float PI = 3.141592653589793;

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

void main() {
	vec2 uv = isf_FragNormCoord;
	vec4 from = getFromColor(uv);
	vec4 to = getToColor(uv);
	float fromM = 1.0 - progress + sin(PI * progress) * strength;
	float toM = progress + sin(PI * progress) * strength;
	gl_FragColor = vec4(
		from.rgb * from.a * fromM + to.rgb * to.a * toM,
		mix(from.a, to.a, progress)
	);
}
