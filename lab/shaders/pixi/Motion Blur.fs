/*{
	"DESCRIPTION": "Directional motion blur: a straight box smear along a velocity vector, with an offset to drag it ahead of or behind the subject. Port of the PixiJS MotionBlurFilter; velocity is in fractions of the frame height.",
	"CREDIT": "PixiJS filters — MotionBlurFilter (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/pixijs/filters/tree/main/src/motion-blur",
	"CATEGORIES": ["Blur", "Motion"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "angle", "LABEL": "Angle (°)", "TYPE": "float", "MIN": 0, "MAX": 360, "DEFAULT": 0 },
		{ "NAME": "blurLength", "LABEL": "Length", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.08 },
		{ "NAME": "kernelSize", "LABEL": "Kernel size", "TYPE": "long", "VALUES": [5, 9, 15, 25, 49], "DEFAULT": 25 },
		{ "NAME": "offset", "LABEL": "Offset", "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0 }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	vec4 color = IMG_NORM_PIXEL(inputImage, uv);
	float a = radians(angle);
	vec2 velPx = vec2(cos(a), sin(a)) * blurLength * RENDERSIZE.y;
	if (kernelSize <= 1 || blurLength <= 0.0) {
		gl_FragColor = color;
		return;
	}
	vec2 velocity = velPx / RENDERSIZE;
	float off = -offset * RENDERSIZE.y / max(length(velPx), 1e-4) - 0.5;
	int k = kernelSize - 1;
	for (int i = 0; i < 48; i++) {
		if (i == k) break;
		color += IMG_NORM_PIXEL(inputImage, uv + velocity * (float(i) / float(k) + off));
	}
	gl_FragColor = color / float(kernelSize);
}
