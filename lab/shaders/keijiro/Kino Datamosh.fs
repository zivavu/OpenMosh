/*{
	"DESCRIPTION": "Datamosh-style compression artifacts: block displacement driven by frame-to-frame motion, DCT-ish noise blocks and smear through a feedback buffer. Port of KinoDatamosh; the camera motion vectors were substituted with a one-step Lucas-Kanade estimate against the previous frame.",
	"CREDIT": "Keijiro Takahashi — KinoDatamosh (port)",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/KinoDatamosh",
	"CATEGORIES": ["Glitch", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "blockSize", "LABEL": "Block size", "TYPE": "float", "MIN": 0.5, "MAX": 16, "DEFAULT": 4 },
		{ "NAME": "quality", "LABEL": "Quality", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
		{ "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "MIN": 0.1, "MAX": 4, "DEFAULT": 1 },
		{ "NAME": "velocity", "LABEL": "Velocity", "TYPE": "float", "MIN": 0, "MAX": 4, "DEFAULT": 1 },
		{ "NAME": "diffusion", "LABEL": "Diffusion", "TYPE": "float", "MIN": 0, "MAX": 8, "DEFAULT": 1 }
	],
	"PASSES": [
		{ "TARGET": "disp", "PERSISTENT": true, "FLOAT": true },
		{ "TARGET": "prev", "PERSISTENT": true },
		{ "TARGET": "work", "PERSISTENT": true },
		{ }
	]
}*/

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float UVRandom(vec2 uv) {
	float f = dot(vec2(12.9898, 78.233), uv);
	return fract(43758.5453 * sin(f));
}

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 px = 1.0 / RENDERSIZE;

	if (PASSINDEX == 0) {
		// Displacement buffer update (frag_update). Motion comes from a
		// Lucas-Kanade step on the previous frame instead of camera vectors.
		float l0 = lum(IMG_NORM_PIXEL(inputImage, uv).rgb);
		float lp = lum(IMG_NORM_PIXEL(prev, uv).rgb);
		float gx = lum(IMG_NORM_PIXEL(prev, uv + vec2(px.x, 0)).rgb) - lum(IMG_NORM_PIXEL(prev, uv - vec2(px.x, 0)).rgb);
		float gy = lum(IMG_NORM_PIXEL(prev, uv + vec2(0, px.y)).rgb) - lum(IMG_NORM_PIXEL(prev, uv - vec2(0, px.y)).rgb);
		vec2 mv = vec2(gx, gy) * (l0 - lp) / (gx * gx + gy * gy + 1e-3);
		mv *= velocity * 24.0;

		vec2 t0 = vec2(TIME, 0);
		vec3 rand = vec3(UVRandom(uv + t0.xy), UVRandom(uv + t0.yx), UVRandom(uv.yx - t0.xx));
		mv += (rand.xy - 0.5) * diffusion;
		mv = round(mv);

		float acc = IMG_NORM_PIXEL(disp, uv).w;
		float mvLen = length(mv);
		float accUpdate = acc + min(mvLen, blockSize) * 0.005 + rand.z * mix(-0.02, 0.02, quality);
		float accReset = rand.z * 0.5 + quality;
		acc = clamp(mvLen > blockSize ? accReset : accUpdate, 0.0, 1.0);
		gl_FragColor = vec4(mv * px, UVRandom(uv + mvLen), acc);
	} else if (PASSINDEX == 1) {
		gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
	} else if (PASSINDEX == 2) {
		// Moshing (frag_mosh): the work buffer holds the previous output.
		vec4 src = IMG_NORM_PIXEL(inputImage, uv);
		vec4 d = IMG_NORM_PIXEL(disp, uv);
		vec3 w = IMG_NORM_PIXEL(work, uv - d.xy * 0.98).rgb;
		vec4 rand = fract(vec4(1.0, 17.37135, 841.4272, 3305.121) * d.z);
		vec2 duv = uv * RENDERSIZE * (rand.x * 80.0 / contrast);
		float dct = cos(mix(duv.x, duv.y, step(0.5, rand.y)));
		dct *= rand.z * (1.0 - rand.x) * contrast;
		float cw = step(0.5, d.w) * dct;
		cw = mix(cw, 1.0, step(rand.w, mix(0.2, 1.0, quality) * step(0.999, d.w)));
		gl_FragColor = vec4(mix(w, src.rgb, cw), 1.0);
	} else {
		gl_FragColor = IMG_NORM_PIXEL(work, uv);
	}
}
