/*{
	"DESCRIPTION": "Sobel gradient kept in color (neon edges) over a faded background. Port of EdgeDetectionSobelNeonV2.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/EdgeDetectionSobelNeonV2",
	"CATEGORIES": ["Stylize", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "edgeWidth", "TYPE": "float", "MIN": 0.05, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "edgeNeonFade", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
		{ "NAME": "brightness", "TYPE": "float", "MIN": 0.2, "MAX": 2.0, "DEFAULT": 1.0 },
		{ "NAME": "backgroundFade", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
		{ "NAME": "backgroundColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] }
	]
}*/

vec3 sobel(float stepx, float stepy, vec2 center) {
	vec3 topLeft = IMG_NORM_PIXEL(inputImage, center + vec2(-stepx, stepy)).rgb;
	vec3 midLeft = IMG_NORM_PIXEL(inputImage, center + vec2(-stepx, 0.0)).rgb;
	vec3 bottomLeft = IMG_NORM_PIXEL(inputImage, center + vec2(-stepx, -stepy)).rgb;
	vec3 midTop = IMG_NORM_PIXEL(inputImage, center + vec2(0.0, stepy)).rgb;
	vec3 midBottom = IMG_NORM_PIXEL(inputImage, center + vec2(0.0, -stepy)).rgb;
	vec3 topRight = IMG_NORM_PIXEL(inputImage, center + vec2(stepx, stepy)).rgb;
	vec3 midRight = IMG_NORM_PIXEL(inputImage, center + vec2(stepx, 0.0)).rgb;
	vec3 bottomRight = IMG_NORM_PIXEL(inputImage, center + vec2(stepx, -stepy)).rgb;
	vec3 Gx = topLeft + 2.0 * midLeft + bottomLeft - topRight - 2.0 * midRight - bottomRight;
	vec3 Gy = -topLeft - 2.0 * midTop - topRight + bottomLeft + 2.0 * midBottom + bottomRight;
	return sqrt((Gx * Gx) + (Gy * Gy));
}

void main() {
	vec2 uv = isf_FragNormCoord;
	vec4 sceneColor = IMG_NORM_PIXEL(inputImage, uv);
	vec3 sobelGradient = sobel(edgeWidth / RENDERSIZE.x, edgeWidth / RENDERSIZE.y, uv);
	vec3 background = mix(backgroundColor.rgb, sceneColor.rgb, backgroundFade);
	vec3 edgeColor = mix(background, sobelGradient, edgeNeonFade);
	gl_FragColor = vec4(edgeColor * brightness, 1.0);
}
