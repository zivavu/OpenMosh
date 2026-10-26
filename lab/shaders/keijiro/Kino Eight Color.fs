/*{
	"DESCRIPTION": "Retro colour reduction: every pixel snaps to the nearest of eight palette colours after a 2×2 Bayer dither, with optional chunky downsampling. Port of KinoEight; the eight colour pickers became palette presets.",
	"CREDIT": "Keijiro Takahashi — KinoEight (port)",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/KinoEight",
	"CATEGORIES": ["Color", "Retro", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "palette", "LABEL": "Palette", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["RGB cube (original)", "CGA 1", "Game Boy", "PICO-8 warm", "Vaporwave", "Mac 1-bit+"], "DEFAULT": 0 },
		{ "NAME": "dithering", "LABEL": "Dithering", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.12 },
		{ "NAME": "downsampling", "LABEL": "Downsampling", "TYPE": "float", "MIN": 1, "MAX": 32, "DEFAULT": 3 },
		{ "NAME": "opacity", "LABEL": "Opacity", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 1 }
	]
}*/

const float bayer2x2[4] = float[4](-0.5, 0.16666666, 0.5, -0.16666666);

vec3 paletteColor(int p, int i) {
	if (p == 1) {
		vec3 c[8] = vec3[8](vec3(0), vec3(0.33, 1, 1), vec3(1, 0.33, 1), vec3(1), vec3(0, 0.67, 0.67), vec3(0.67, 0, 0.67), vec3(0.67), vec3(0.33));
		return c[i];
	}
	if (p == 2) {
		vec3 c[8] = vec3[8](vec3(0.06, 0.22, 0.06), vec3(0.19, 0.38, 0.19), vec3(0.55, 0.67, 0.06), vec3(0.61, 0.74, 0.06), vec3(0.06, 0.22, 0.06), vec3(0.19, 0.38, 0.19), vec3(0.55, 0.67, 0.06), vec3(0.61, 0.74, 0.06));
		return c[i];
	}
	if (p == 3) {
		vec3 c[8] = vec3[8](vec3(0), vec3(0.11, 0.17, 0.33), vec3(0.49, 0.15, 0.33), vec3(0, 0.53, 0.32), vec3(0.67, 0.32, 0.21), vec3(1, 0, 0.3), vec3(1, 0.64, 0), vec3(1, 0.95, 0.91));
		return c[i];
	}
	if (p == 4) {
		vec3 c[8] = vec3[8](vec3(0.09, 0.03, 0.2), vec3(0.3, 0.1, 0.5), vec3(1, 0.3, 0.75), vec3(0.2, 0.9, 1), vec3(0.98, 0.85, 0.4), vec3(0.6, 0.4, 1), vec3(1, 0.6, 0.6), vec3(0.95, 0.95, 1));
		return c[i];
	}
	if (p == 5) {
		vec3 c[8] = vec3[8](vec3(0), vec3(1), vec3(0), vec3(1), vec3(0.85, 0.1, 0.1), vec3(0), vec3(1), vec3(0));
		return c[i];
	}
	vec3 c[8] = vec3[8](vec3(0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(1, 1, 0), vec3(0, 0, 1), vec3(1, 0, 1), vec3(0, 1, 1), vec3(1));
	return c[i];
}

void main() {
	int ds = int(max(1.0, floor(downsampling)));
	ivec2 pss = ivec2(gl_FragCoord.xy) / ds;
	vec2 at = (vec2(pss * ds) + 0.5) / RENDERSIZE;
	vec4 col = IMG_NORM_PIXEL(inputImage, at);
	vec3 src = IMG_THIS_NORM_PIXEL(inputImage).rgb;

	vec3 c = col.rgb + bayer2x2[(pss.y & 1) * 2 + (pss.x & 1)] * dithering;
	vec4 best = vec4(paletteColor(palette, 0), distance(paletteColor(palette, 0), c));
	for (int i = 1; i < 8; i++) {
		vec3 p = paletteColor(palette, i);
		float d = distance(p, c);
		if (d < best.a) best = vec4(p, d);
	}
	gl_FragColor = vec4(mix(src, best.rgb, opacity), 1.0);
}
