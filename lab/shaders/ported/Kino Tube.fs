/*{
	"DESCRIPTION": "Analog tube look done in YIQ: chroma bleeds sideways over several taps, luma fringing is pushed into the chroma channels, plus scanlines. Port of KinoTube.",
	"CREDIT": "Keijiro Takahashi — KinoTube (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/keijiro/KinoTube",
	"CATEGORIES": ["Retro", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "bleeding", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "fringing", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "scanline", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 }
	]
}*/

#define PI 3.14159265358979

vec3 rgb2yiq(vec3 rgb) {
	rgb = clamp(rgb, 0.0, 1.0);
	// HLSL mul(row-major M, v) == GLSL v * M with the same arguments.
	return rgb * mat3(0.299, 0.587, 0.114,
	                  0.596, -0.274, -0.322,
	                  0.211, -0.523, 0.313);
}
vec3 yiq2rgb(vec3 yiq) {
	vec3 rgb = yiq * mat3(1.0, 0.956, 0.621,
	                      1.0, -0.272, -0.647,
	                      1.0, -1.106, 1.703);
	return clamp(rgb, 0.0, 1.0);
}
vec3 sampleYIQ(vec2 uv, float du) {
	uv.x += du;
	return rgb2yiq(IMG_NORM_PIXEL(inputImage, uv).rgb);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	// Tap layout mirrors Tube.cs.
	float bleedWidth = 0.04 * bleeding;
	float bleedStep = 2.5 / RENDERSIZE.x;
	int bleedTaps = int(ceil(bleedWidth / bleedStep));
	float bleedDelta = bleedTaps > 0 ? bleedWidth / float(bleedTaps) : 0.0;
	float fringeDelta = 0.0025 * fringing;

	vec3 yiq = sampleYIQ(uv, 0.0);
	for (int i = 0; i < bleedTaps; i++) {
		yiq.y += sampleYIQ(uv, -bleedDelta * float(i)).y;
		yiq.z += sampleYIQ(uv, bleedDelta * float(i)).z;
	}
	yiq.yz /= float(bleedTaps + 1);
	float y1 = sampleYIQ(uv, -fringeDelta).x;
	float y2 = sampleYIQ(uv, fringeDelta).x;
	yiq.yz += y2 - y1;
	float scan = sin(uv.y * 500.0 * PI);
	scan = mix(1.0, (scan + 1.0) / 2.0, scanline);
	gl_FragColor = vec4(yiq2rgb(yiq * scan), 1.0);
}
