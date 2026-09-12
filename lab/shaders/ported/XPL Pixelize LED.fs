/*{
	"DESCRIPTION": "Pixelation with a round LED falloff inside each cell over a background color. Port of PixelizeLed.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/PixelizeLed",
	"CATEGORIES": ["Stylize", "Retro", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "pixelSize", "TYPE": "float", "MIN": 8.0, "MAX": 300.0, "DEFAULT": 80.0 },
		{ "NAME": "ledRadius", "TYPE": "float", "MIN": 0.0, "MAX": 1.5, "DEFAULT": 0.8 },
		{ "NAME": "backgroundColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	float pixelRatio = RENDERSIZE.x / RENDERSIZE.y;
	float pixelScale = 1.0 / pixelSize;
	vec2 coord = vec2(pixelScale * floor(uv.x / pixelScale),
	                  (pixelScale * pixelRatio) * floor(uv.y / (pixelScale * pixelRatio)));
	vec4 color = IMG_NORM_PIXEL(inputImage, coord);
	vec2 c = uv * vec2(pixelSize, pixelSize / pixelRatio);
	float ledX = abs(sin(c.x * 3.1415)) * 1.5;
	float ledY = abs(sin(c.y * 3.1415)) * 1.5;
	float ledValue = ledX * ledY;
	float radius = step(ledValue, ledRadius);
	color = ((1.0 - radius) * color) + ((color * ledValue) * radius) + radius * (1.0 - ledValue) * backgroundColor;
	gl_FragColor = color;
}
