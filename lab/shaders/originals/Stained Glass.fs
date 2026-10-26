/*{
	"DESCRIPTION": "Voronoi stained glass: the frame breaks into irregular panes, each filled with the colour under its centre, lit from behind with a soft glass mottle and held together by dark lead lines. With lead at zero it becomes a plain crystallize; cells can wander over time.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Stylize", "Mosaic"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "cellSize", "LABEL": "Pane size", "TYPE": "float", "MIN": 0.01, "MAX": 0.25, "DEFAULT": 0.045 },
		{ "NAME": "lead", "LABEL": "Lead width", "TYPE": "float", "MIN": 0, "MAX": 0.3, "DEFAULT": 0.08 },
		{ "NAME": "leadColor", "LABEL": "Lead colour", "TYPE": "color", "DEFAULT": [0.05, 0.04, 0.04, 1] },
		{ "NAME": "saturation", "LABEL": "Saturation", "TYPE": "float", "MIN": 0, "MAX": 2.5, "DEFAULT": 1.4 },
		{ "NAME": "glow", "LABEL": "Backlight", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.45 },
		{ "NAME": "mottle", "LABEL": "Glass mottle", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.35 },
		{ "NAME": "wander", "LABEL": "Wander", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 0 }
	]
}*/

vec2 hash22(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash22(i).x, b = hash22(i + vec2(1, 0)).x, c = hash22(i + vec2(0, 1)).x, d = hash22(i + vec2(1, 1)).x;
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 seed(vec2 cell) {
	vec2 h = hash22(cell);
	return cell + 0.5 + 0.45 * sin(6.2831 * h + TIME * wander * (0.5 + h.yx));
}

void main() {
	float aspect = RENDERSIZE.x / RENDERSIZE.y;
	vec2 p = isf_FragNormCoord * vec2(aspect, 1.0) / cellSize;
	vec2 cell = floor(p);

	float d1 = 1e9, d2 = 1e9;
	vec2 s1 = vec2(0.0), c1 = vec2(0.0);
	for (int y = -2; y <= 2; y++)
		for (int x = -2; x <= 2; x++) {
			vec2 c = cell + vec2(x, y);
			vec2 s = seed(c);
			float d = distance(p, s);
			if (d < d1) { d2 = d1; d1 = d; s1 = s; c1 = c; }
			else if (d < d2) d2 = d;
		}
	// Exact distance to the bisector between the two nearest seeds.
	vec2 sN = vec2(0.0);
	float best = 1e9;
	for (int y = -2; y <= 2; y++)
		for (int x = -2; x <= 2; x++) {
			vec2 s = seed(cell + vec2(x, y));
			if (distance(s, s1) < 1e-4) continue;
			float e = dot(p - 0.5 * (s1 + s), normalize(s - s1));
			best = min(best, abs(e));
		}

	vec2 at = s1 * cellSize / vec2(aspect, 1.0);
	vec3 col = IMG_NORM_PIXEL(inputImage, clamp(at, 0.0, 1.0)).rgb;
	float l = dot(col, vec3(0.299, 0.587, 0.114));
	col = clamp(mix(vec3(l), col, saturation), 0.0, 1.0);

	float m = vnoise(p * 3.0 + c1 * 7.0) * 0.6 + vnoise(p * 9.0) * 0.4;
	col *= 1.0 + (m - 0.5) * mottle;
	col *= 1.0 + glow * (0.6 - d1);

	float aa = fwidth(best) * 1.5;
	float leadMask = 1.0 - smoothstep(lead - aa, lead + aa, best);
	if (lead <= 0.0) leadMask = 0.0;
	gl_FragColor = vec4(mix(col, leadColor.rgb, leadMask * leadColor.a), 1.0);
}
