/*{
	"DESCRIPTION": "Watercolor: edge strokes are integrated along the luminance gradient's tangent, fills are smeared along the gradient with a noisy hue wobble, and the two are multiplied. Port of KinoAqua; the shipped noise texture is generated in a persistent pass.",
	"CREDIT": "Keijiro Takahashi — KinoAqua (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/keijiro/KinoAqua",
	"CATEGORIES": ["Stylize", "Drawing", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "opacity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
		{ "NAME": "edgeColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] },
		{ "NAME": "edgeContrast", "TYPE": "float", "MIN": 0.01, "MAX": 4.0, "DEFAULT": 1.2 },
		{ "NAME": "fillColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] },
		{ "NAME": "blurWidth", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0 },
		{ "NAME": "blurFrequency", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
		{ "NAME": "hueShift", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1 },
		{ "NAME": "interval", "TYPE": "float", "MIN": 0.1, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "iteration", "TYPE": "long", "MIN": 4, "MAX": 32, "DEFAULT": 20 }
	],
	"PASSES": [
		{ "TARGET": "noiseTex", "WIDTH": "256", "HEIGHT": "256", "PERSISTENT": true },
		{}
	]
}*/

#define saturate(x) clamp((x), 0.0, 1.0)

// --- tileable value noise for the noise texture -------------------------------
vec3 hash3(vec2 p) {
	vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
	return fract(sin(q) * 43758.5453);
}
vec3 vnoise(vec2 p, float period) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	vec2 i00 = mod(i, period), i10 = mod(i + vec2(1.0, 0.0), period);
	vec2 i01 = mod(i + vec2(0.0, 1.0), period), i11 = mod(i + vec2(1.0, 1.0), period);
	return mix(mix(hash3(i00), hash3(i10), f.x), mix(hash3(i01), hash3(i11), f.x), f.y);
}

// --- Aqua -----------------------------------------------------------------------
float aspectRatio;
float aspectRatioRcp;
float iterationRcp;

vec2 rotate90(vec2 v) { return v.yx * vec2(-1.0, 1.0); }
vec2 uv2sc(vec2 uv) { vec2 p = uv - 0.5; p.x *= aspectRatio; return p; }
vec2 sc2uv(vec2 p) { p.x *= aspectRatioRcp; return p + 0.5; }
vec3 sampleColor(vec2 p) { return IMG_NORM_PIXEL(inputImage, sc2uv(p)).rgb; }
float sampleLuminance(vec2 p) { return dot(sampleColor(p), vec3(0.2126, 0.7152, 0.0722)); }
vec3 sampleNoise(vec2 p) { return IMG_NORM_PIXEL(noiseTex, fract(p)).rgb; }

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, saturate(p - K.xxx), c.y);
}

vec2 getGradient(vec2 p, float freq) {
	vec2 dx = vec2(interval / 200.0, 0.0);
	float ldx = sampleLuminance(p + dx.xy) - sampleLuminance(p - dx.xy);
	float ldy = sampleLuminance(p + dx.yx) - sampleLuminance(p - dx.yx);
	vec2 n = sampleNoise(p * 0.4 * freq).gb - 0.5;
	return vec2(ldx, ldy) + n * 0.05;
}
float processEdge(inout vec2 p, float stride) {
	vec2 grad = getGradient(p, 1.0);
	float edge = saturate(length(grad) * 10.0);
	float pattern = sampleNoise(p * 0.8).r;
	p += normalize(rotate90(grad)) * stride;
	return pattern * edge;
}
vec3 processFill(inout vec2 p, float stride) {
	vec2 grad = getGradient(p, blurFrequency);
	p += normalize(grad) * stride;
	float shift = sampleNoise(p * 0.1).r * 2.0;
	return sampleColor(p) * hsv2rgb(vec3(shift, hueShift, 1.0));
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (PASSINDEX == 0) {
		// Two octaves of tileable noise, built once and kept.
		if (FRAMEINDEX > 1) {
			gl_FragColor = IMG_THIS_NORM_PIXEL(noiseTex);
			return;
		}
		vec3 n = vnoise(uv * 8.0, 8.0) * 0.65 + vnoise(uv * 16.0, 16.0) * 0.35;
		gl_FragColor = vec4(n, 1.0);
		return;
	}
	aspectRatio = RENDERSIZE.x / RENDERSIZE.y;
	aspectRatioRcp = 1.0 / aspectRatio;
	iterationRcp = 1.0 / float(iteration);

	vec2 p = uv2sc(uv);
	vec2 p_e_n = p, p_e_p = p, p_c_n = p, p_c_p = p;
	float Stride = 0.04 * iterationRcp;
	float acc_e = 0.0;
	vec3 acc_c = vec3(0.0);
	float sum_e = 0.0;
	float sum_c = 0.0;
	for (int i = 0; i < iteration; i++) {
		float w_e = 1.5 - float(i) * iterationRcp;
		acc_e += processEdge(p_e_n, -Stride) * w_e;
		acc_e += processEdge(p_e_p, Stride) * w_e;
		sum_e += w_e * 2.0;
		float w_c = 0.2 + float(i) * iterationRcp;
		acc_c += processFill(p_c_n, -Stride * blurWidth) * w_c;
		acc_c += processFill(p_c_p, Stride * blurWidth) * w_c * 0.3;
		sum_c += w_c * 1.3;
	}
	acc_e /= sum_e;
	acc_c /= sum_c;
	acc_e = saturate((acc_e - 0.5) * edgeContrast + 0.5);
	vec3 rgb_e = mix(vec3(1.0), edgeColor.rgb, edgeColor.a * acc_e);
	vec3 rgb_f = mix(vec3(1.0), acc_c, fillColor.a) * fillColor.rgb;
	vec3 src = IMG_NORM_PIXEL(inputImage, uv).rgb;
	gl_FragColor = vec4(mix(src, rgb_e * rgb_f, opacity), 1.0);
}
