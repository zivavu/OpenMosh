/*{
	"DESCRIPTION": "Dots on a grid: each cell shows a disc of its sampled color over a background. Port of PixelizeSector.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/PixelizeSector",
	"CATEGORIES": ["Stylize", "Halftone Effect", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "pixelSize", "TYPE": "float", "MIN": 8.0, "MAX": 300.0, "DEFAULT": 60.0 },
		{ "NAME": "circleRadius", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "pixelIntervalX", "TYPE": "float", "MIN": 0.2, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "pixelIntervalY", "TYPE": "float", "MIN": 0.2, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "backgroundColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	float pixelScale = 1.0 / pixelSize;
	float ratio = RENDERSIZE.y / RENDERSIZE.x;
	uv.x = uv.x / ratio;
	vec2 coord = vec2(pixelIntervalX * floor(uv.x / (pixelScale * pixelIntervalX)),
	                  pixelIntervalY * floor(uv.y / (pixelScale * pixelIntervalY)));
	vec2 circleCenter = coord * pixelScale;
	float dist = length(uv - circleCenter) * pixelSize;
	circleCenter.x *= ratio;
	vec4 screenColor = IMG_NORM_PIXEL(inputImage, circleCenter);
	if (dist > circleRadius) screenColor = backgroundColor;
	gl_FragColor = screenColor;
}
