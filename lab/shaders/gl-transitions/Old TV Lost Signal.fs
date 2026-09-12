/*{
	"DESCRIPTION": "Old TV losing signal: random scanlines tear sideways and drift while the two images crossfade. Port of gl-transitions old_tv_lost_signal.",
	"CREDIT": "mernking (Godswork) — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/old_tv_lost_signal.glsl",
	"CATEGORIES": ["Transition", "Retro"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 }
	]
}*/

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float p = progress;
	float strength = sin(p * 3.14159265);

	vec4 color = mix(getFromColor(uv), getToColor(uv), p);

	float lineY = floor(uv.y * 120.0);
	float noise = hash(vec2(lineY, p * 20.0));
	float line = step(0.92, noise);

	float drift = sin(uv.y * 30.0 + p * 10.0) * 0.02 * strength;
	vec4 lineColor = mix(getFromColor(uv + vec2(drift, 0.0)), getToColor(uv + vec2(drift, 0.0)), p);

	color = mix(color, lineColor, line * strength);
	color.rgb -= sin(uv.y * 900.0) * 0.03 * strength;

	gl_FragColor = color;
}
