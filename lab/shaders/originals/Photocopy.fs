/*{
	"DESCRIPTION": "Cheap photocopier: the picture is blurred and thresholded into toner, gaining heavier edges and lost midtones with each extra generation. Adds toner speckle, white dropouts, streaks from a dirty drum, uneven exposure and a slight skew.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Print", "Stylize", "Texture"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "threshold", "LABEL": "Threshold", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.48 },
		{ "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "MIN": 0.01, "MAX": 0.3, "DEFAULT": 0.06 },
		{ "NAME": "generations", "LABEL": "Generations", "TYPE": "float", "MIN": 0, "MAX": 6, "DEFAULT": 2 },
		{ "NAME": "edgeBoost", "LABEL": "Edge darkening", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 1.2 },
		{ "NAME": "speckle", "LABEL": "Speckle", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.2 },
		{ "NAME": "streaks", "LABEL": "Drum streaks", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.4 },
		{ "NAME": "skew", "LABEL": "Skew (°)", "TYPE": "float", "MIN": -5, "MAX": 5, "DEFAULT": 0.6 },
		{ "NAME": "toner", "LABEL": "Toner", "TYPE": "color", "DEFAULT": [0.07, 0.07, 0.08, 1] },
		{ "NAME": "paper", "LABEL": "Paper", "TYPE": "color", "DEFAULT": [0.95, 0.94, 0.9, 1] },
		{ "NAME": "boil", "LABEL": "Boil (Hz)", "TYPE": "float", "MIN": 0, "MAX": 24, "DEFAULT": 8 }
	]
}*/

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
float lum(vec2 uv) { return dot(IMG_NORM_PIXEL(inputImage, uv).rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
	float aspect = RENDERSIZE.x / RENDERSIZE.y;
	float a = radians(skew);
	vec2 p = (isf_FragNormCoord - 0.5) * vec2(aspect, 1.0);
	p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
	vec2 uv = p / vec2(aspect, 1.0) + 0.5;
	float frame = floor(TIME * boil);

	// Each generation softens the original a bit more before it is thresholded again.
	float r = (1.0 + generations * 1.2) / RENDERSIZE.y;
	float l = lum(uv);
	float blur = 0.0;
	for (int i = 0; i < 12; i++) {
		float t = float(i) * 2.39996;
		vec2 o = vec2(cos(t), sin(t)) * sqrt(float(i) + 0.5) / sqrt(12.0) * r * 2.0;
		blur += lum(uv + o * vec2(1.0 / aspect, 1.0));
	}
	blur /= 12.0;
	float v = mix(l, blur, clamp(generations / 3.0, 0.0, 1.0));
	v += (v - blur) * edgeBoost;

	// Uneven exposure across the glass, darker towards one edge.
	v += (vnoise(isf_FragNormCoord * 2.0 + 3.0) - 0.5) * 0.12 - (1.0 - isf_FragNormCoord.x) * 0.05;
	v += (hash12(gl_FragCoord.xy + frame * 31.7) - 0.5) * 0.05;
	float paperAmt = smoothstep(threshold - contrast, threshold + contrast, v);

	float n = hash12(floor(gl_FragCoord.xy / 1.5) + frame * 17.0);
	paperAmt = mix(paperAmt, 0.0, step(1.0 - speckle * 0.02, n) * step(0.5, paperAmt));
	paperAmt = mix(paperAmt, 1.0, step(1.0 - speckle * 0.05, 1.0 - n) * step(paperAmt, 0.5));

	float col = floor(gl_FragCoord.x / 2.0);
	float streak = step(1.0 - streaks * 0.04, hash12(vec2(col, 3.0))) * (0.5 + 0.5 * vnoise(vec2(col, gl_FragCoord.y / 60.0)));
	paperAmt *= 1.0 - streak * 0.8;

	vec3 outc = mix(toner.rgb, paper.rgb, paperAmt);
	bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
	gl_FragColor = vec4(outside ? toner.rgb * 1.6 : outc, 1.0);
}
