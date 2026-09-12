/*{
	"DESCRIPTION": "The frame shatters into Voronoi fragments that slide apart along random directions, revealing the next image behind. Port of gl-transitions Fragment.",
	"CREDIT": "lbl — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/fragment.glsl",
	"CATEGORIES": ["Transition", "Distortion"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 }
	]
}*/

#define POINTS 10

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

float random(vec2 par) {
	return fract(sin(dot(par.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
vec2 random2(vec2 par) {
	float rand = random(par);
	return vec2(rand, random(par + rand));
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (progress <= 0.0) { gl_FragColor = getFromColor(uv); return; }
	if (progress >= 1.0) { gl_FragColor = getToColor(uv); return; }

	const float duration = 8.0;
	float time = progress * duration;
	vec2 point[POINTS];
	for (int i = 0; i < POINTS; i++) {
		point[i] = random2(vec2(float(i)));
	}

	vec4 col = getToColor(uv);

	for (int i = 0; i < POINTS; i++) {
		vec2 dir = normalize(random2(vec2(float(i), float(i) + 11.0)));
		float v = (1.0 + random(dir) * 0.5) * 0.2;
		vec2 ofst = dir * clamp(time - 0.5, 0.0, duration) * v;
		vec2 U = uv - ofst;
		if (U.x < 0.0 || U.x > 1.0 || U.y < 0.0 || U.y > 1.0) continue;

		float distI = distance(U, point[i]);
		bool closest = true;
		for (int j = 0; j < POINTS; j++) {
			if (distance(U, point[j]) < distI) {
				closest = false;
				break;
			}
		}
		if (closest) {
			col = getFromColor(U);
			break;
		}
	}
	gl_FragColor = col;
}
