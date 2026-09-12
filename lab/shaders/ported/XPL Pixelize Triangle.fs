/*{
	"DESCRIPTION": "Pixelation into triangle or leaf-shaped cells. Port of PixelizeTriangle / PixelizeLeaf (they differ by one constant).",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/PixelizeTriangle",
	"CATEGORIES": ["Stylize", "Tile Effect", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "shape", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Triangle", "Leaf"], "DEFAULT": 0 },
		{ "NAME": "pixelSize", "TYPE": "float", "MIN": 4.0, "MAX": 200.0, "DEFAULT": 40.0 },
		{ "NAME": "pixelScaleX", "TYPE": "float", "MIN": 0.2, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "pixelScaleY", "TYPE": "float", "MIN": 0.2, "MAX": 5.0, "DEFAULT": 1.0 }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	float pixelRatio = RENDERSIZE.x / RENDERSIZE.y;
	vec2 pixelScale = pixelSize * vec2(pixelScaleX, pixelScaleY / pixelRatio);
	vec2 coord = floor(uv * pixelScale) / pixelScale;
	uv -= coord;
	uv *= pixelScale;
	float k = shape == 0 ? 2.0 : 1.0;
	coord += vec2(step(1.0 - uv.y, uv.x) / (k * pixelScale.x),
	              step(uv.x, uv.y) / (k * pixelScale.y));
	gl_FragColor = IMG_NORM_PIXEL(inputImage, coord);
}
