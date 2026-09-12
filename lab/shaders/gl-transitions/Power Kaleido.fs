/*{
	"DESCRIPTION": "Kaleidoscopic mirror tunnel that spins and folds the frame while crossfading. Port of gl-transitions powerKaleido; the global `dist` initializer was moved into the function (GLSL requires constant global initializers).",
	"CREDIT": "Boundless — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/powerKaleido.glsl",
	"CATEGORIES": ["Transition", "Kaleidoscope"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "scale", "LABEL": "Scale", "TYPE": "float", "MIN": 0.5, "MAX": 5, "DEFAULT": 2 },
		{ "NAME": "z", "LABEL": "Zoom", "TYPE": "float", "MIN": 0.5, "MAX": 4, "DEFAULT": 1.5 },
		{ "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "MIN": 0, "MAX": 20, "DEFAULT": 5 }
	]
}*/

#define PI 3.14159265358979
const float rad = 120.0;
const float deg = rad / 180.0 * PI;

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

vec2 refl(vec2 p, vec2 o, vec2 n) {
	return 2.0 * o + 2.0 * n * dot(p - o, n) - p;
}
vec2 rot(vec2 p, vec2 o, float a) {
	float s = sin(a);
	float c = cos(a);
	return o + mat2(c, -s, s, c) * (p - o);
}

void main() {
	vec2 uv0 = isf_FragNormCoord;
	vec2 uv = uv0;
	float ratio = RENDERSIZE.x / RENDERSIZE.y;
	float dist = scale / 10.0;

	uv -= 0.5;
	uv.x *= ratio;
	uv *= z;
	uv = rot(uv, vec2(0.0), progress * speed);
	for (int iter = 0; iter < 10; iter++) {
		for (float i = 0.0; i < 2.0 * PI; i += deg) {
			float ts = sign(asin(cos(i))) == 1.0 ? 1.0 : 0.0;
			if (((ts == 1.0) && (uv.y - dist * cos(i) > tan(i) * (uv.x + dist * sin(i)))) ||
			    ((ts == 0.0) && (uv.y - dist * cos(i) < tan(i) * (uv.x + dist * sin(i))))) {
				uv = refl(vec2(uv.x + sin(i) * dist * 2.0, uv.y - cos(i) * dist * 2.0), vec2(0.0), vec2(cos(i), sin(i)));
			}
		}
	}
	uv += 0.5;
	uv = rot(uv, vec2(0.5), progress * -speed);
	uv -= 0.5;
	uv.x /= ratio;
	uv += 0.5;
	uv = 2.0 * abs(uv / 2.0 - floor(uv / 2.0 + 0.5));
	vec2 uvMix = mix(uv, uv0, cos(progress * PI * 2.0) / 2.0 + 0.5);
	gl_FragColor = mix(getFromColor(uvMix), getToColor(uvMix), cos((progress - 1.0) * PI) / 2.0 + 0.5);
}
