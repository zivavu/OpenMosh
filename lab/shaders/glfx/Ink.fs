/*{
	"DESCRIPTION": "Ink drawing: darkens wherever a 5×5 average and a small cross average disagree, so outlines and texture read as pen strokes over the colour. Port of glfx.js ink().",
	"CREDIT": "Evan Wallace — glfx.js (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/evanw/glfx.js/blob/master/src/filters/fun/ink.js",
	"CATEGORIES": ["Stylize", "Edges"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "strength", "LABEL": "Strength", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.35 }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 dx = vec2(1.0 / RENDERSIZE.x, 0.0);
	vec2 dy = vec2(0.0, 1.0 / RENDERSIZE.y);
	vec4 color = IMG_NORM_PIXEL(inputImage, uv);
	float bigTotal = 0.0;
	float smallTotal = 0.0;
	vec3 bigAverage = vec3(0.0);
	vec3 smallAverage = vec3(0.0);
	for (float x = -2.0; x <= 2.0; x += 1.0) {
		for (float y = -2.0; y <= 2.0; y += 1.0) {
			vec3 s = IMG_NORM_PIXEL(inputImage, uv + dx * x + dy * y).rgb;
			bigAverage += s;
			bigTotal += 1.0;
			if (abs(x) + abs(y) < 2.0) {
				smallAverage += s;
				smallTotal += 1.0;
			}
		}
	}
	vec3 edge = max(vec3(0.0), bigAverage / bigTotal - smallAverage / smallTotal);
	float s5 = strength * strength * strength * strength * strength;
	gl_FragColor = vec4(color.rgb - dot(edge, edge) * s5 * 100000.0, 1.0);
}
