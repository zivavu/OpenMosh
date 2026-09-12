/*{
	"DESCRIPTION": "Cut through a burst of analog TV static. Port of gl-transitions TVStatic.",
	"CREDIT": "Brandon Anzaldi — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/TVStatic.glsl",
	"CATEGORIES": ["Transition", "Retro"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "offset", "LABEL": "Static span", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.05 }
	]
}*/

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

float noise(vec2 co) {
	float dt = dot(co.xy * progress, vec2(12.9898, 78.233));
	float sn = mod(dt, 3.14);
	return fract(sin(sn) * 43758.5453);
}

void main() {
	vec2 p = isf_FragNormCoord;
	if (progress < offset) {
		gl_FragColor = getFromColor(p);
	} else if (progress > 1.0 - offset) {
		gl_FragColor = getToColor(p);
	} else {
		gl_FragColor = vec4(vec3(noise(p)), 1.0);
	}
}
