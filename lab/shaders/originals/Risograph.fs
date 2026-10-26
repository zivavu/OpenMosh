/*{
	"DESCRIPTION": "Risograph print: the picture is separated into two or three spot inks by least squares in log (optical density) space, each ink is screened at its own angle with grainy, uneven coverage, the drums print slightly out of register, and the inks multiply onto off-white paper.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Print", "Color", "Stylize"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "inks", "LABEL": "Inks", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["Fluo pink + blue", "Pink + blue + yellow", "Teal + orange", "Red + black"], "DEFAULT": 1 },
		{ "NAME": "screen", "LABEL": "Screen", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Dots", "Grain"], "DEFAULT": 0 },
		{ "NAME": "dotSize", "LABEL": "Dot size (px)", "TYPE": "float", "MIN": 2, "MAX": 16, "DEFAULT": 4 },
		{ "NAME": "misregister", "LABEL": "Misregistration", "TYPE": "float", "MIN": 0, "MAX": 0.02, "DEFAULT": 0.004 },
		{ "NAME": "unevenness", "LABEL": "Uneven ink", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.45 },
		{ "NAME": "density", "LABEL": "Ink density", "TYPE": "float", "MIN": 0.3, "MAX": 2, "DEFAULT": 1.1 },
		{ "NAME": "shuffle", "LABEL": "Re-register (Hz)", "TYPE": "float", "MIN": 0, "MAX": 12, "DEFAULT": 0 }
	]
}*/

vec3 inkColor(int i) {
	if (inks == 2) return i == 0 ? vec3(0.0, 0.51, 0.54) : vec3(1.0, 0.42, 0.12);
	if (inks == 3) return i == 0 ? vec3(0.9, 0.12, 0.16) : vec3(0.1, 0.1, 0.12);
	if (i == 0) return vec3(1.0, 0.28, 0.6);
	if (i == 1) return vec3(0.0, 0.47, 0.75);
	return vec3(1.0, 0.91, 0.0);
}
int inkCount() { return inks == 1 ? 3 : 2; }

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

// Density of each ink: solve D·c ≈ -log(rgb), D's columns are each ink's density.
vec3 separate(vec3 rgb) {
	vec3 target = -log(max(rgb, vec3(0.02)));
	int n = inkCount();
	vec3 d0 = -log(max(inkColor(0), vec3(0.02)));
	vec3 d1 = -log(max(inkColor(1), vec3(0.02)));
	vec3 d2 = -log(max(inkColor(2), vec3(0.02)));
	if (n == 2) {
		float a = dot(d0, d0), b = dot(d0, d1), c = dot(d1, d1);
		float det = a * c - b * b;
		vec2 r = vec2(dot(d0, target), dot(d1, target));
		vec2 x = vec2(c * r.x - b * r.y, a * r.y - b * r.x) / max(det, 1e-5);
		return vec3(clamp(x, 0.0, 1.0), 0.0);
	}
	mat3 D = mat3(d0, d1, d2);
	vec3 x = inverse(transpose(D) * D + mat3(1e-3)) * (transpose(D) * target);
	return clamp(x, 0.0, 1.0);
}

float screenInk(float cov, int i, vec2 frag) {
	cov = clamp(cov * density, 0.0, 1.0);
	float uneven = (vnoise(frag / 37.0 + float(i) * 13.1) - 0.5) * unevenness * 0.6;
	cov = clamp(cov + uneven * cov, 0.0, 1.0);
	if (screen == 1) return step(hash12(frag + float(i) * 91.7), cov);
	float ang = radians(15.0 + float(i) * 30.0);
	mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
	vec2 g = r * frag / dotSize;
	vec2 cell = fract(g) - 0.5;
	float radius = sqrt(cov) * 0.62;
	float edge = 0.12 + hash12(floor(g) + float(i)) * 0.08;
	return 1.0 - smoothstep(radius - edge, radius + edge, length(cell) + (hash12(frag) - 0.5) * 0.08);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 frag = gl_FragCoord.xy;
	float shuffleSeed = floor(TIME * shuffle);
	vec3 paper = vec3(0.97, 0.95, 0.9) * (0.97 + 0.03 * vnoise(frag * 0.7));
	vec3 col = paper;
	int n = inkCount();
	for (int i = 0; i < 3; i++) {
		if (i >= n) break;
		vec2 h = vec2(hash12(vec2(float(i) * 3.1, shuffleSeed)), hash12(vec2(shuffleSeed, float(i) * 5.7))) - 0.5;
		vec2 off = h * 2.0 * misregister * vec2(RENDERSIZE.y / RENDERSIZE.x, 1.0);
		float cov = separate(IMG_NORM_PIXEL(inputImage, uv + off).rgb)[i];
		float ink = screenInk(cov, i, frag + off * RENDERSIZE);
		col *= mix(vec3(1.0), inkColor(i), ink);
	}
	gl_FragColor = vec4(col, 1.0);
}
