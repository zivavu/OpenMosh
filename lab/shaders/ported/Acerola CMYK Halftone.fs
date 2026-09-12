/*{
	"DESCRIPTION": "Print-style halftone: CMYK separation, each ink screened with its own rotated sine grid, then recombined with per-ink misregistration offsets. Port of AcerolaFX_Halftone.",
	"CREDIT": "Garrett Gunnell (Acerola) — AcerolaFX (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/GarrettGunnell/AcerolaFX/blob/main/Shaders/AcerolaFX_Halftone.fx",
	"CATEGORIES": ["Halftone Effect", "Stylize", "Acerola"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "printCyan", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "cyanDotSize", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0 },
		{ "NAME": "cyanBias", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.0 },
		{ "NAME": "cyanExponent", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 1.0 },
		{ "NAME": "cyanOffset", "TYPE": "point2D", "MIN": [-10.0, -10.0], "MAX": [10.0, 10.0], "DEFAULT": [0.0, 0.0] },
		{ "NAME": "printMagenta", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "magentaDotSize", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0 },
		{ "NAME": "magentaBias", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.0 },
		{ "NAME": "magentaExponent", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 1.0 },
		{ "NAME": "magentaOffset", "TYPE": "point2D", "MIN": [-10.0, -10.0], "MAX": [10.0, 10.0], "DEFAULT": [0.0, 0.0] },
		{ "NAME": "printYellow", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "yellowDotSize", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0 },
		{ "NAME": "yellowBias", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.0 },
		{ "NAME": "yellowExponent", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 1.0 },
		{ "NAME": "yellowOffset", "TYPE": "point2D", "MIN": [-10.0, -10.0], "MAX": [10.0, 10.0], "DEFAULT": [0.0, 0.0] },
		{ "NAME": "printBlack", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "blackDotSize", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0 },
		{ "NAME": "blackBias", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.0 },
		{ "NAME": "blackExponent", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 1.0 },
		{ "NAME": "blackOffset", "TYPE": "point2D", "MIN": [-10.0, -10.0], "MAX": [10.0, 10.0], "DEFAULT": [0.0, 0.0] }
	],
	"PASSES": [
		{ "TARGET": "inks" },
		{}
	]
}*/

#define saturate(x) clamp((x), 0.0, 1.0)

float halftone(vec2 uv, float v, float bias, float dotSize, float curve) {
	float h = (sin(uv.x * RENDERSIZE.x * dotSize) + sin(uv.y * RENDERSIZE.y * dotSize)) / 2.0;
	return h < pow(saturate(v + bias), curve) ? 1.0 : 0.0;
}
vec2 rot(vec2 uv, float a) {
	// HLSL mul(uv, R) with R = {cos,-sin; sin,cos} rows.
	return vec2(uv.x * cos(a) + uv.y * sin(a), -uv.x * sin(a) + uv.y * cos(a));
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (PASSINDEX == 0) {
		vec4 col = saturate(IMG_NORM_PIXEL(inputImage, uv));
		float k = min(1.0 - col.r, min(1.0 - col.g, 1.0 - col.b));
		vec3 cmy = vec3(0.0);
		float invK = 1.0 - k;
		if (invK != 0.0) cmy = (1.0 - col.rgb - k) / invK;
		cmy.r = halftone(rot(uv, 0.261799), cmy.r, cyanBias, cyanDotSize, cyanExponent);
		cmy.g = halftone(rot(uv, 1.309), cmy.g, magentaBias, magentaDotSize, magentaExponent);
		cmy.b = halftone(uv, cmy.b, yellowBias, yellowDotSize, yellowExponent);
		k = halftone(rot(uv, 0.785398), k, blackBias, blackDotSize, blackExponent);
		gl_FragColor = vec4(cmy, k);
	} else {
		vec2 texel = 1.0 / RENDERSIZE;
		float c = IMG_NORM_PIXEL(inks, uv + cyanOffset * texel).r;
		float m = IMG_NORM_PIXEL(inks, uv + magentaOffset * texel).g;
		float y = IMG_NORM_PIXEL(inks, uv + yellowOffset * texel).b;
		float k = IMG_NORM_PIXEL(inks, uv + blackOffset * texel).a;
		vec3 result = vec3(1.0);
		result.r -= c * float(printCyan);
		result.g -= m * float(printMagenta);
		result.b -= y * float(printYellow);
		gl_FragColor = vec4(saturate(result - k * float(printBlack)), 1.0);
	}
}
