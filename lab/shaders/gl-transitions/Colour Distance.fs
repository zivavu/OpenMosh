/*{
	"DESCRIPTION": "Dissolve driven by the per-pixel color distance between the two images: similar colors swap first. Port of gl-transitions ColourDistance.",
	"CREDIT": "P-Seebauer — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/ColourDistance.glsl",
	"CATEGORIES": ["Transition", "Dissolve"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "power", "LABEL": "Power", "TYPE": "float", "MIN": 1, "MAX": 10, "DEFAULT": 5 }
	]
}*/

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

void main() {
	vec2 p = isf_FragNormCoord;
	vec4 fTex = getFromColor(p);
	vec4 tTex = getToColor(p);
	float m = step(distance(fTex, tTex), progress);
	gl_FragColor = mix(mix(fTex, tTex, m), tTex, pow(progress, power));
}
