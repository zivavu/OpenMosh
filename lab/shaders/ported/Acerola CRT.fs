/*{
	"DESCRIPTION": "Barrel curvature, soft edge vignette and out-of-phase RGB scanline modulation. Port of AcerolaFX_CRT.",
	"CREDIT": "Garrett Gunnell (Acerola) — AcerolaFX (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/GarrettGunnell/AcerolaFX/blob/main/Shaders/AcerolaFX_CRT.fx",
	"CATEGORIES": ["Retro", "Acerola"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "curvature", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 10.0 },
		{ "NAME": "vignetteWidth", "TYPE": "float", "MIN": 1.0, "MAX": 100.0, "DEFAULT": 30.0 },
		{ "NAME": "lineSize", "TYPE": "long", "MIN": 0, "MAX": 4, "DEFAULT": 0 },
		{ "NAME": "lineStrength", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "brightnessAdjust", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0 }
	]
}*/

#define saturate(x) clamp((x), 0.0, 1.0)

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 crtUV = uv * 2.0 - 1.0;
	vec2 offset = crtUV.yx / curvature;
	crtUV = crtUV + crtUV * offset * offset;
	crtUV = crtUV * 0.5 + 0.5;
	vec4 col = IMG_NORM_PIXEL(inputImage, crtUV);
	vec3 output = saturate(col.rgb);
	if (crtUV.x <= 0.0 || 1.0 <= crtUV.x || crtUV.y <= 0.0 || 1.0 <= crtUV.y) output = vec3(0.0);
	crtUV = crtUV * 2.0 - 1.0;
	vec2 vignette = vignetteWidth / RENDERSIZE;
	vignette = smoothstep(vec2(0.0), vignette, 1.0 - abs(crtUV));
	vignette = saturate(vignette);
	float lines = RENDERSIZE.y / exp2(float(lineSize));
	output.g *= (sin(uv.y * lines * 2.0) + 1.0) * 0.15 * lineStrength + 1.0 + brightnessAdjust;
	output.rb *= (cos(uv.y * lines * 2.0) + 1.0) * 0.135 * lineStrength + 1.0 + brightnessAdjust;
	output = saturate(output) * vignette.x * vignette.y;
	gl_FragColor = vec4(output, col.a);
}
