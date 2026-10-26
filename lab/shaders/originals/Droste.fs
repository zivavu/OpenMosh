/*{
	"DESCRIPTION": "Droste / Escher recursion: the frame contains a smaller copy of itself, forever, zooming in or out. Twist bends the levels into Escher's 'Print Gallery' spiral (one full turn per level at 1), and a frame line can mark each picture edge.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Geometry", "Feedback"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "inner", "LABEL": "Inner scale", "TYPE": "float", "MIN": 0.15, "MAX": 0.85, "DEFAULT": 0.45 },
		{ "NAME": "twist", "LABEL": "Twist", "TYPE": "float", "MIN": -1, "MAX": 1, "DEFAULT": 1 },
		{ "NAME": "speed", "LABEL": "Zoom speed", "TYPE": "float", "MIN": -2, "MAX": 2, "DEFAULT": 0.25 },
		{ "NAME": "center", "LABEL": "Centre", "TYPE": "point2D", "MIN": [0, 0], "MAX": [1, 1], "DEFAULT": [0.5, 0.5] },
		{ "NAME": "frameLine", "LABEL": "Frame line", "TYPE": "float", "MIN": 0, "MAX": 0.05, "DEFAULT": 0.006 }
	]
}*/

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

void main() {
	float aspect = RENDERSIZE.x / RENDERSIZE.y;
	vec2 half_ = vec2(0.5 * aspect, 0.5);
	vec2 c = (center - 0.5) * vec2(aspect, 1.0);
	vec2 z = (isf_FragNormCoord - 0.5) * vec2(aspect, 1.0) - c;

	float s = clamp(inner, 0.05, 0.95);
	float L = log(1.0 / s);
	// Rotate the log-polar plane so one turn around equals one level of scale.
	float beta = atan(L / 6.28318530718) * twist;
	vec2 w = vec2(log(max(length(z), 1e-6)), atan(z.y, z.x));
	w = cmul(w, vec2(cos(beta), sin(beta))) * cos(beta);
	w.x += fract(TIME * speed) * L;
	z = exp(w.x) * vec2(cos(w.y), sin(w.y));

	// Rescale by whole levels until z lands between the inner picture and the frame edge.
	float edge = 0.0;
	for (int i = 0; i < 24; i++) {
		vec2 qo = abs(z + c) / half_;
		vec2 qi = abs(z / s + c) / half_;
		float outer = max(qo.x, qo.y);
		float innerR = max(qi.x, qi.y);
		if (outer > 1.0) z *= s;
		else if (innerR < 1.0) z /= s;
		else { edge = min(1.0 - outer, (innerR - 1.0) * s); break; }
	}
	vec2 uv = (z + c) / vec2(aspect, 1.0) + 0.5;
	vec3 col = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.0, 1.0)).rgb;
	float line = 1.0 - smoothstep(frameLine * 0.5, frameLine, edge);
	if (frameLine > 0.0) col = mix(col, vec3(0.02), line * 0.85);
	gl_FragColor = vec4(col, 1.0);
}
