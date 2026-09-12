/*{
	"DESCRIPTION": "Grid of tiles flips like slats, each on its own random schedule, with divider lines flashing between. Port of gl-transitions GridFlip.",
	"CREDIT": "TimDonselaar — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/GridFlip.glsl",
	"CATEGORIES": ["Transition", "Tile Effect"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "grid", "LABEL": "Grid", "TYPE": "point2D", "MIN": [1, 1], "MAX": [16, 16], "DEFAULT": [4, 4] },
		{ "NAME": "pause", "LABEL": "Pause", "TYPE": "float", "MIN": 0, "MAX": 0.4, "DEFAULT": 0.1 },
		{ "NAME": "dividerWidth", "LABEL": "Divider", "TYPE": "float", "MIN": 0, "MAX": 0.3, "DEFAULT": 0.05 },
		{ "NAME": "bgcolor", "LABEL": "Divider color", "TYPE": "color", "DEFAULT": [0, 0, 0, 1] },
		{ "NAME": "randomness", "LABEL": "Randomness", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.1 }
	]
}*/

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

float rand(vec2 co) {
	return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
float getDelta(vec2 p, vec2 sz) {
	vec2 rectanglePos = floor(sz * p);
	vec2 rectangleSize = vec2(1.0 / sz.x, 1.0 / sz.y);
	float top = rectangleSize.y * (rectanglePos.y + 1.0);
	float bottom = rectangleSize.y * rectanglePos.y;
	float left = rectangleSize.x * rectanglePos.x;
	float right = rectangleSize.x * (rectanglePos.x + 1.0);
	float minX = min(abs(p.x - left), abs(p.x - right));
	float minY = min(abs(p.y - top), abs(p.y - bottom));
	return min(minX, minY);
}
float getDividerSize(vec2 sz) {
	vec2 rectangleSize = vec2(1.0 / sz.x, 1.0 / sz.y);
	return min(rectangleSize.x, rectangleSize.y) * dividerWidth;
}

void main() {
	vec2 p = isf_FragNormCoord;
	vec2 sz = vec2(int(grid.x), int(grid.y));

	if (progress < pause) {
		float currentProg = progress / pause;
		float a = 1.0;
		if (getDelta(p, sz) < getDividerSize(sz)) a = 1.0 - currentProg;
		gl_FragColor = mix(bgcolor, getFromColor(p), a);
	} else if (progress < 1.0 - pause) {
		if (getDelta(p, sz) < getDividerSize(sz)) {
			gl_FragColor = bgcolor;
		} else {
			float currentProg = (progress - pause) / (1.0 - pause * 2.0);
			vec2 q = p;
			vec2 rectanglePos = floor(sz * q);
			float r = rand(rectanglePos) - randomness;
			float cp = smoothstep(0.0, 1.0 - r, currentProg);
			float rectangleSize = 1.0 / sz.x;
			float delta = rectanglePos.x * rectangleSize;
			float offset = rectangleSize / 2.0 + delta;
			p.x = (p.x - offset) / abs(cp - 0.5) * 0.5 + offset;
			vec4 a = getFromColor(p);
			vec4 b = getToColor(p);
			float s = step(abs(sz.x * (q.x - delta) - 0.5), abs(cp - 0.5));
			gl_FragColor = mix(bgcolor, mix(b, a, step(cp, 0.5)), s);
		}
	} else {
		float currentProg = (progress - 1.0 + pause) / pause;
		float a = 1.0;
		if (getDelta(p, sz) < getDividerSize(sz)) a = currentProg;
		gl_FragColor = mix(bgcolor, getToColor(p), a);
	}
}
