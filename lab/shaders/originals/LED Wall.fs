/*{
	"DESCRIPTION": "Stadium LED wall / jumbotron: the picture is rebuilt from discrete emitters (round LEDs, RGB triads, or LCD stripes) with limited bit depth, bloom that spills into neighbouring cells, a few dead pixels and a rolling refresh band.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Screen", "Stylize", "Pixel"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "cell", "LABEL": "Cell size (px)", "TYPE": "float", "MIN": 3, "MAX": 40, "DEFAULT": 9 },
		{ "NAME": "emitters", "LABEL": "Emitters", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["Round LED", "RGB triad", "LCD stripes"], "DEFAULT": 0 },
		{ "NAME": "levels", "LABEL": "Levels", "TYPE": "float", "MIN": 2, "MAX": 64, "DEFAULT": 16 },
		{ "NAME": "bloom", "LABEL": "Bloom", "TYPE": "float", "MIN": 0, "MAX": 1.5, "DEFAULT": 0.35 },
		{ "NAME": "gain", "LABEL": "Brightness", "TYPE": "float", "MIN": 0.5, "MAX": 3, "DEFAULT": 1.1 },
		{ "NAME": "dead", "LABEL": "Dead pixels", "TYPE": "float", "MIN": 0, "MAX": 0.1, "DEFAULT": 0.006 },
		{ "NAME": "refresh", "LABEL": "Refresh band", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.25 }
	]
}*/

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec3 cellColor(vec2 c) {
	vec2 at = (c + 0.5) * cell / RENDERSIZE;
	vec3 col = IMG_NORM_PIXEL(inputImage, clamp(at, 0.0, 1.0)).rgb;
	col = floor(col * (levels - 1.0) + 0.5) / (levels - 1.0);
	if (hash12(c + 17.0) < dead) col = hash12(c) < 0.3 ? vec3(1.0, 0.1, 0.1) * 0.8 : vec3(0.0);
	return col;
}

// How much each channel of the cell's emitters lights point f (in cell units, centre 0).
vec3 emitter(vec2 f) {
	if (emitters == 1) {
		vec3 e;
		for (int k = 0; k < 3; k++) {
			vec2 o = vec2(float(k - 1) * 0.3, k == 1 ? 0.12 : -0.12);
			e[k] = exp(-dot(f - o, f - o) / 0.018);
		}
		return e * 1.7;
	}
	if (emitters == 2) {
		float x = f.x + 0.5;
		vec3 band = vec3(step(0.04, x) * step(x, 0.3), step(0.37, x) * step(x, 0.63), step(0.7, x) * step(x, 0.96));
		return band * step(abs(f.y), 0.42) * 1.25;
	}
	float r = length(f);
	return vec3(1.0 - smoothstep(0.3, 0.42, r)) + exp(-r * r / 0.05) * 0.4;
}

void main() {
	vec2 p = gl_FragCoord.xy / cell;
	vec2 c = floor(p);
	vec2 f = fract(p) - 0.5;
	vec3 col = cellColor(c) * emitter(f);
	if (bloom > 0.0) {
		vec3 halo = vec3(0.0);
		for (int y = -1; y <= 1; y++)
			for (int x = -1; x <= 1; x++) {
				vec2 o = vec2(x, y);
				float d = length(f - o);
				halo += cellColor(c + o) * exp(-d * d * 2.2);
			}
		col += halo * bloom * 0.18;
	}
	float band = fract(isf_FragNormCoord.y - TIME * 0.35);
	col *= 1.0 - refresh * 0.35 * smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.08, 0.2, band));
	gl_FragColor = vec4(col * gain, 1.0);
}
