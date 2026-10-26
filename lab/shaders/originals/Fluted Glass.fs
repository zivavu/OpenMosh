/*{
	"DESCRIPTION": "Reeded / fluted glass: the picture is seen through parallel glass ribs that each refract it as a small lens, with prism dispersion, a frosted blur along the rib, and a specular sheen. Ribs can run at any angle or radiate from the centre.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Distortion", "Glass"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "ribs", "LABEL": "Ribs", "TYPE": "float", "MIN": 3, "MAX": 120, "DEFAULT": 24 },
		{ "NAME": "angle", "LABEL": "Angle (°)", "TYPE": "float", "MIN": 0, "MAX": 180, "DEFAULT": 0 },
		{ "NAME": "profile", "LABEL": "Profile", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["Convex", "Concave", "Wave", "Prism"], "DEFAULT": 0 },
		{ "NAME": "radial", "LABEL": "Radial", "TYPE": "bool", "DEFAULT": false },
		{ "NAME": "refraction", "LABEL": "Refraction", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 1.2 },
		{ "NAME": "dispersion", "LABEL": "Dispersion", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.12 },
		{ "NAME": "frost", "LABEL": "Frost", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.25 },
		{ "NAME": "sheen", "LABEL": "Sheen", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 },
		{ "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "MIN": -1, "MAX": 1, "DEFAULT": 0 }
	]
}*/

// Lens slope across a rib, t in [-1, 1].
float slope(float t) {
	if (profile == 1) return t;
	if (profile == 2) return sin(t * 3.14159265);
	if (profile == 3) return 1.0;
	return -t;
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float aspect = RENDERSIZE.x / RENDERSIZE.y;
	vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

	float coord;
	vec2 across;
	if (radial) {
		float a = atan(p.y, p.x);
		coord = a / 6.28318530718 * ribs;
		across = vec2(-sin(a), cos(a));
	} else {
		float r = radians(angle);
		across = vec2(cos(r), sin(r));
		coord = dot(p, across) * ribs;
	}
	coord += TIME * drift;
	float t = fract(coord) * 2.0 - 1.0;
	float ribWidth = radial ? max(length(p), 0.05) * 6.28318530718 / ribs : 1.0 / ribs;

	vec2 along = vec2(-across.y, across.x);
	float off = slope(t) * refraction * ribWidth;
	vec2 toUv = vec2(1.0 / aspect, 1.0);

	// Dispersion: each channel refracts a little differently.
	vec3 col = vec3(0.0);
	float jitter = hash12(gl_FragCoord.xy) - 0.5;
	const int TAPS = 6;
	for (int i = 0; i < TAPS; i++) {
		float k = (float(i) + 0.5 + jitter) / float(TAPS) - 0.5;
		vec2 f = along * k * frost * ribWidth * 2.5;
		vec2 base = p + f;
		col.r += IMG_NORM_PIXEL(inputImage, (base + across * off * (1.0 + dispersion)) * toUv + 0.5).r;
		col.g += IMG_NORM_PIXEL(inputImage, (base + across * off) * toUv + 0.5).g;
		col.b += IMG_NORM_PIXEL(inputImage, (base + across * off * (1.0 - dispersion)) * toUv + 0.5).b;
	}
	col /= float(TAPS);

	// Sheen on the rib crest, a thin dark seam where ribs meet.
	float crest = exp(-pow((t + 0.35) * 4.0, 2.0));
	float seam = smoothstep(0.82, 1.0, abs(t));
	col += sheen * 0.35 * crest;
	col *= 1.0 - seam * 0.35 * sheen;
	gl_FragColor = vec4(col, 1.0);
}
