/*{
	"DESCRIPTION": "Two stacked simplex-noise waves warp scanlines sideways with a proportional RGB split. Port of GlitchWaveJitter.",
	"CREDIT": "QianMo — X-PostProcessing-Library (port); simplex noise by Ashima Arts / Stefan Gustavson",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/QianMo/X-PostProcessing-Library/tree/master/Assets/X-PostProcessing/Effects/GlitchWaveJitter",
	"CATEGORIES": ["Glitch", "Distortion", "XPL"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "direction", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Horizontal", "Vertical"], "DEFAULT": 0 },
		{ "NAME": "infinite", "TYPE": "bool", "DEFAULT": false, "LABEL": "Constant (no pulsing)" },
		{ "NAME": "frequency", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 5.0 },
		{ "NAME": "rgbSplit", "TYPE": "float", "MIN": 0.0, "MAX": 50.0, "DEFAULT": 20.0 },
		{ "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25 },
		{ "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0 }
	]
}*/

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
	const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
	vec2 i = floor(v + dot(v, C.yy));
	vec2 x0 = v - i + dot(i, C.xx);
	vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
	vec4 x12 = x0.xyxy + C.xxzz;
	x12.xy -= i1;
	i = mod289(i);
	vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
	vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
	m = m * m;
	m = m * m;
	vec3 x = 2.0 * fract(p * C.www) - 1.0;
	vec3 h = abs(x) - 0.5;
	vec3 ox = floor(x + 0.5);
	vec3 a0 = x - ox;
	m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
	vec3 g;
	g.x = a0.x * x0.x + h.x * x0.y;
	g.yz = a0.yz * x12.xz + h.yz * x12.yw;
	return 130.0 * dot(m, g);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float strength = infinite ? 1.0 : 0.5 + 0.5 * cos(TIME * frequency);
	vec2 res = RENDERSIZE;
	if (direction == 0) {
		float uv_y = uv.y * res.y;
		float noise_wave_1 = snoise(vec2(uv_y * 0.01, TIME * speed * 20.0)) * (strength * amount * 32.0);
		float noise_wave_2 = snoise(vec2(uv_y * 0.02, TIME * speed * 10.0)) * (strength * amount * 4.0);
		float noise_wave_x = noise_wave_1 * noise_wave_2 / res.x;
		float uv_x = uv.x + noise_wave_x;
		float rgbSplit_uv_x = (rgbSplit * 50.0 + (20.0 * strength + 1.0)) * noise_wave_x / res.x;
		vec4 colorG = IMG_NORM_PIXEL(inputImage, vec2(uv_x, uv.y));
		vec4 colorRB = IMG_NORM_PIXEL(inputImage, vec2(uv_x + rgbSplit_uv_x, uv.y));
		gl_FragColor = vec4(colorRB.r, colorG.g, colorRB.b, colorRB.a + colorG.a);
	} else {
		float uv_x = uv.x * res.x;
		float noise_wave_1 = snoise(vec2(uv_x * 0.01, TIME * speed * 20.0)) * (strength * amount * 32.0);
		float noise_wave_2 = snoise(vec2(uv_x * 0.02, TIME * speed * 10.0)) * (strength * amount * 4.0);
		float noise_wave_y = noise_wave_1 * noise_wave_2 / res.x;
		float uv_y = uv.y + noise_wave_y;
		float rgbSplit_uv_y = (rgbSplit * 50.0 + (20.0 * strength + 1.0)) * noise_wave_y / res.y;
		vec4 colorG = IMG_NORM_PIXEL(inputImage, vec2(uv.x, uv_y));
		vec4 colorRB = IMG_NORM_PIXEL(inputImage, vec2(uv.x, uv_y + rgbSplit_uv_y));
		gl_FragColor = vec4(colorRB.r, colorG.g, colorRB.b, colorRB.a + colorG.a);
	}
}
