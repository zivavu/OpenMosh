/*{
	"DESCRIPTION": "Hexagonal-cell pixelation. Port of PixelizeHexagon.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/PixelizeHexagon",
	"CATEGORIES": ["Stylize", "Tile Effect", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "pixelSize", "TYPE": "float", "MIN": 0.005, "MAX": 0.2, "DEFAULT": 0.03 },
		{ "NAME": "pixelScaleX", "TYPE": "float", "MIN": 0.2, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "pixelScaleY", "TYPE": "float", "MIN": 0.2, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "useAspect", "TYPE": "bool", "DEFAULT": true, "LABEL": "Keep hexagons regular" }
	]
}*/

vec2 nearestHex(float s, vec2 st) {
	float h = 0.5 * s;
	float r = 0.8660254 * s;
	float m = h / r;
	vec2 sect = st / vec2(2.0 * r, h + s);
	vec2 sectPxl = mod(st, vec2(2.0 * r, h + s));
	float aSection = mod(floor(sect.y), 2.0);
	vec2 coord = floor(sect);
	if (aSection > 0.0) {
		if (sectPxl.y < (h - sectPxl.x * m)) {
			coord -= 1.0;
		} else if (sectPxl.y < (-h + sectPxl.x * m)) {
			coord.y -= 1.0;
		}
	} else {
		if (sectPxl.x > r) {
			if (sectPxl.y < (2.0 * h - sectPxl.x * m)) {
				coord.y -= 1.0;
			}
		} else {
			if (sectPxl.y < (sectPxl.x * m)) {
				coord.y -= 1.0;
			} else {
				coord.x -= 1.0;
			}
		}
	}
	float xoff = mod(coord.y, 2.0) * r;
	return vec2(coord.x * 2.0 * r - xoff, coord.y * (h + s)) + vec2(r * 2.0, s);
}

void main() {
	float pixelRatio = useAspect ? RENDERSIZE.x / RENDERSIZE.y : 1.0;
	vec2 ratio = vec2(pixelRatio * pixelScaleX, pixelScaleY);
	vec2 nearest = nearestHex(pixelSize, isf_FragNormCoord * ratio);
	gl_FragColor = IMG_NORM_PIXEL(inputImage, nearest / ratio);
}
