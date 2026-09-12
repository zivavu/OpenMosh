/*{
	"DESCRIPTION": "Water reflection: below a boundary line the frame is mirrored and rippled with travelling sine waves that grow and fade towards the bottom. Port of the PixiJS ReflectionFilter.",
	"CREDIT": "PixiJS filters — ReflectionFilter (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/pixijs/filters/tree/main/src/reflection",
	"CATEGORIES": ["Distortion", "Water"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "boundary", "LABEL": "Boundary", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.6 },
		{ "NAME": "mirror", "LABEL": "Mirror", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "ampMin", "LABEL": "Amp min (px)", "TYPE": "float", "MIN": 0, "MAX": 20, "DEFAULT": 2 },
		{ "NAME": "ampMax", "LABEL": "Amp max (px)", "TYPE": "float", "MIN": 0, "MAX": 20, "DEFAULT": 8 },
		{ "NAME": "waveMin", "LABEL": "Wave min (px)", "TYPE": "float", "MIN": 5, "MAX": 200, "DEFAULT": 30 },
		{ "NAME": "waveMax", "LABEL": "Wave max (px)", "TYPE": "float", "MIN": 5, "MAX": 200, "DEFAULT": 100 },
		{ "NAME": "alphaMin", "LABEL": "Alpha min", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.9 },
		{ "NAME": "alphaMax", "LABEL": "Alpha max", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
		{ "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "MIN": 0, "MAX": 5, "DEFAULT": 1 }
	]
}*/

void main() {
	vec2 uv = isf_FragNormCoord;
	if (uv.y < boundary) {
		gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
		return;
	}

	float k = (uv.y - boundary) / (1.0 - boundary + 0.0001);
	float v = boundary + boundary - uv.y;
	float y = mirror ? v : uv.y;

	float amp = mix(ampMin, ampMax, k) / RENDERSIZE.x;
	float wl = mix(waveMin, waveMax, k) / RENDERSIZE.y;
	float al = mix(alphaMin, alphaMax, k);

	float x = uv.x + cos(v * 6.2831853 / wl - TIME * speed) * amp;
	x = clamp(x, 0.0, 1.0);

	vec4 color = IMG_NORM_PIXEL(inputImage, vec2(x, y));
	gl_FragColor = vec4(color.rgb * al, 1.0);
}
