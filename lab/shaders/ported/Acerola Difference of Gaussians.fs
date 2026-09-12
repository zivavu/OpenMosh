/*{
	"DESCRIPTION": "Flow-based extended Difference of Gaussians (XDoG): ink-line / manga / woodcut looks. Edge tangent flow from a blurred structure tensor, DoG across the flow, line-integral smoothing along it, then thresholding and blending. Port of AcerolaFX_DifferenceOfGaussians without the hatching textures.",
	"CREDIT": "Garrett Gunnell (Acerola) — AcerolaFX (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/GarrettGunnell/AcerolaFX/blob/main/Shaders/AcerolaFX_DifferenceOfGaussians.fx",
	"CATEGORIES": ["Stylize", "Drawing", "Acerola"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "useFlow", "TYPE": "bool", "DEFAULT": true, "LABEL": "Follow edge flow" },
		{ "NAME": "sigmaC", "TYPE": "float", "MIN": 0.1, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Tensor blur" },
		{ "NAME": "sigmaE", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 2.0, "LABEL": "Edge sigma" },
		{ "NAME": "k", "TYPE": "float", "MIN": 0.1, "MAX": 5.0, "DEFAULT": 1.6, "LABEL": "K (sigma ratio)" },
		{ "NAME": "p", "TYPE": "float", "MIN": 0.0, "MAX": 100.0, "DEFAULT": 1.0, "LABEL": "Sharpness P" },
		{ "NAME": "calcDiffBeforeConvolving", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "sigmaM", "TYPE": "float", "MIN": 0.1, "MAX": 20.0, "DEFAULT": 2.0, "LABEL": "Flow smoothing" },
		{ "NAME": "lineIntegralStep", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0 },
		{ "NAME": "smoothEdges", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "sigmaA", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 2.0, "LABEL": "Anti-alias sigma" },
		{ "NAME": "thresholding", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["None", "Tanh", "Quantize", "Smooth quantize"], "DEFAULT": 1 },
		{ "NAME": "thresholds", "TYPE": "long", "MIN": 1, "MAX": 16, "DEFAULT": 3, "LABEL": "Quantize levels" },
		{ "NAME": "threshold", "TYPE": "float", "MIN": 0.0, "MAX": 100.0, "DEFAULT": 20.0 },
		{ "NAME": "phi", "TYPE": "float", "MIN": 0.0, "MAX": 10.0, "DEFAULT": 1.0, "LABEL": "Threshold softness" },
		{ "NAME": "blendMode", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["Two colors", "Ink over image", "Interpolate"], "DEFAULT": 0 },
		{ "NAME": "minColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] },
		{ "NAME": "maxColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] },
		{ "NAME": "termStrength", "TYPE": "float", "MIN": 0.0, "MAX": 5.0, "DEFAULT": 1.0 },
		{ "NAME": "blendStrength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
	],
	"PASSES": [
		{ "TARGET": "labTex", "FLOAT": true },
		{ "TARGET": "tensor", "FLOAT": true },
		{ "TARGET": "tensorH", "FLOAT": true },
		{ "TARGET": "tfm", "FLOAT": true },
		{ "TARGET": "dogH", "FLOAT": true },
		{ "TARGET": "dog", "FLOAT": true },
		{ "TARGET": "dogAA", "FLOAT": true },
		{}
	]
}*/

#define PI 3.14159265358979
#define saturate(x) clamp((x), 0.0, 1.0)

float gaussian(float sigma, float pos) {
	return (1.0 / sqrt(2.0 * PI * sigma * sigma)) * exp(-(pos * pos) / (2.0 * sigma * sigma));
}

vec3 rgb2xyz(vec3 c) {
	vec3 tmp;
	tmp.x = (c.r > 0.04045) ? pow(abs((c.r + 0.055) / 1.055), 2.4) : c.r / 12.92;
	tmp.y = (c.g > 0.04045) ? pow(abs((c.g + 0.055) / 1.055), 2.4) : c.g / 12.92;
	tmp.z = (c.b > 0.04045) ? pow(abs((c.b + 0.055) / 1.055), 2.4) : c.b / 12.92;
	// HLSL mul(row-vector, M) == GLSL M * v with the same argument order.
	mat3 m = mat3(0.4124, 0.3576, 0.1805,
	              0.2126, 0.7152, 0.0722,
	              0.0193, 0.1192, 0.9505);
	return 100.0 * (m * tmp);
}
vec3 xyz2lab(vec3 c) {
	vec3 n = c / vec3(95.047, 100.0, 108.883);
	vec3 v;
	v.x = (n.x > 0.008856) ? pow(abs(n.x), 1.0 / 3.0) : (7.787 * n.x) + (16.0 / 116.0);
	v.y = (n.y > 0.008856) ? pow(abs(n.y), 1.0 / 3.0) : (7.787 * n.y) + (16.0 / 116.0);
	v.z = (n.z > 0.008856) ? pow(abs(n.z), 1.0 / 3.0) : (7.787 * n.z) + (16.0 / 116.0);
	return vec3((116.0 * v.y) - 16.0, 500.0 * (v.x - v.y), 200.0 * (v.y - v.z));
}
vec3 rgb2lab(vec3 c) {
	vec3 lab = xyz2lab(rgb2xyz(c));
	return vec3(lab.x / 100.0, 0.5 + 0.5 * (lab.y / 127.0), 0.5 + 0.5 * (lab.z / 127.0));
}

vec3 fetchLab(vec2 px) { return IMG_PIXEL(labTex, px).rgb; }

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 px = gl_FragCoord.xy;
	vec2 texel = 1.0 / RENDERSIZE;

	if (PASSINDEX == 0) {
		gl_FragColor = vec4(rgb2lab(IMG_NORM_PIXEL(inputImage, uv).rgb), 1.0);
	} else if (PASSINDEX == 1) {
		vec2 d = vec2(1.0);
		vec3 Sx = (
			 1.0 * fetchLab(px + vec2(-d.x, -d.y)) +
			 2.0 * fetchLab(px + vec2(-d.x, 0.0)) +
			 1.0 * fetchLab(px + vec2(-d.x, d.y)) +
			-1.0 * fetchLab(px + vec2(d.x, -d.y)) +
			-2.0 * fetchLab(px + vec2(d.x, 0.0)) +
			-1.0 * fetchLab(px + vec2(d.x, d.y))) / 4.0;
		vec3 Sy = (
			 1.0 * fetchLab(px + vec2(-d.x, -d.y)) +
			 2.0 * fetchLab(px + vec2(0.0, -d.y)) +
			 1.0 * fetchLab(px + vec2(d.x, -d.y)) +
			-1.0 * fetchLab(px + vec2(-d.x, d.y)) +
			-2.0 * fetchLab(px + vec2(0.0, d.y)) +
			-1.0 * fetchLab(px + vec2(d.x, d.y))) / 4.0;
		gl_FragColor = vec4(dot(Sx, Sx), dot(Sy, Sy), dot(Sx, Sy), 1.0);
	} else if (PASSINDEX == 2) {
		int kernelRadius = int(max(1.0, floor(sigmaC * 2.45)));
		vec3 col = vec3(0.0);
		float kernelSum = 0.0;
		for (int x = -kernelRadius; x <= kernelRadius; ++x) {
			vec3 c = IMG_NORM_PIXEL(tensor, uv + vec2(x, 0) * texel).rgb;
			float gauss = gaussian(sigmaC, float(x));
			col += c * gauss;
			kernelSum += gauss;
		}
		gl_FragColor = vec4(col / kernelSum, 1.0);
	} else if (PASSINDEX == 3) {
		int kernelRadius = int(max(1.0, floor(sigmaC * 2.45)));
		vec3 col = vec3(0.0);
		float kernelSum = 0.0;
		for (int y = -kernelRadius; y <= kernelRadius; ++y) {
			vec3 c = IMG_NORM_PIXEL(tensorH, uv + vec2(0, y) * texel).rgb;
			float gauss = gaussian(sigmaC, float(y));
			col += c * gauss;
			kernelSum += gauss;
		}
		vec3 g = col / kernelSum;
		float lambda1 = 0.5 * (g.y + g.x + sqrt(max(0.0, g.y * g.y - 2.0 * g.x * g.y + g.x * g.x + 4.0 * g.z * g.z)));
		vec2 d = vec2(g.x - lambda1, g.z);
		if (d.x > 0.0) d.x = -d.x;
		gl_FragColor = length(d) > 0.0 ? vec4(normalize(d), sqrt(lambda1), 1.0) : vec4(0.0, 1.0, 0.0, 1.0);
	} else if (PASSINDEX == 4) {
		int kernelRadius = sigmaE * 2.0 > 1.0 ? int(sigmaE * 2.0) : 1;
		vec2 col = vec2(0.0);
		vec2 kernelSum = vec2(0.0);
		if (useFlow) {
			vec2 t = IMG_NORM_PIXEL(tfm, uv).xy;
			vec2 n = vec2(t.y, -t.x);
			vec2 nabs = abs(n);
			float ds = 1.0 / ((nabs.x > nabs.y) ? nabs.x : nabs.y);
			n *= texel;
			col = IMG_NORM_PIXEL(labTex, uv).xx;
			kernelSum = vec2(1.0);
			for (int x = int(ds); x <= kernelRadius; ++x) {
				float gauss1 = gaussian(sigmaE, float(x));
				float gauss2 = gaussian(sigmaE * k, float(x));
				float c1 = IMG_NORM_PIXEL(labTex, uv - float(x) * n).r;
				float c2 = IMG_NORM_PIXEL(labTex, uv + float(x) * n).r;
				col.r += (c1 + c2) * gauss1;
				kernelSum.x += 2.0 * gauss1;
				col.g += (c1 + c2) * gauss2;
				kernelSum.y += 2.0 * gauss2;
			}
			col /= kernelSum;
			gl_FragColor = vec4(col, (1.0 + p) * (col.r * 100.0) - p * (col.g * 100.0), 1.0);
		} else {
			for (int x = -kernelRadius; x <= kernelRadius; ++x) {
				float c = IMG_NORM_PIXEL(labTex, uv + vec2(x, 0) * texel).r;
				float gauss1 = gaussian(sigmaE, float(x));
				float gauss2 = gaussian(sigmaE * k, float(x));
				col.r += c * gauss1;
				kernelSum.r += gauss1;
				col.g += c * gauss2;
				kernelSum.g += gauss2;
			}
			gl_FragColor = vec4(col / kernelSum, 1.0, 1.0);
		}
	} else if (PASSINDEX == 5) {
		int kernelRadius = sigmaE * 2.0 > 1.0 ? int(sigmaE * 2.0) : 1;
		float D = 0.0;
		if (useFlow) {
			kernelRadius = sigmaM * 2.0 > 1.0 ? int(sigmaM * 2.0) : 1;
			vec3 c = IMG_NORM_PIXEL(dogH, uv).rgb;
			vec2 G = calcDiffBeforeConvolving ? vec2(c.b, 0.0) : c.rg;
			vec2 w = vec2(1.0);
			vec2 v = IMG_NORM_PIXEL(tfm, uv).xy * texel;
			vec2 st0 = uv;
			vec2 v0 = v;
			for (int d = 1; d <= kernelRadius; ++d) {
				st0 += v0 * lineIntegralStep;
				vec3 c2 = IMG_NORM_PIXEL(dogH, st0).rgb;
				float gauss1 = gaussian(sigmaM, float(d));
				if (calcDiffBeforeConvolving) {
					G.r += gauss1 * c2.b;
					w.x += gauss1;
				} else {
					float gauss2 = gaussian(sigmaM * k, float(d));
					G.r += gauss1 * c2.r;
					w.x += gauss1;
					G.g += gauss2 * c2.g;
					w.y += gauss2;
				}
				v0 = IMG_NORM_PIXEL(tfm, st0).xy * texel;
			}
			vec2 st1 = uv;
			vec2 v1 = v;
			for (int d = 1; d <= kernelRadius; ++d) {
				st1 -= v1 * lineIntegralStep;
				vec3 c2 = IMG_NORM_PIXEL(dogH, st1).rgb;
				float gauss1 = gaussian(sigmaM, float(d));
				if (calcDiffBeforeConvolving) {
					G.r += gauss1 * c2.b;
					w.x += gauss1;
				} else {
					float gauss2 = gaussian(sigmaM * k, float(d));
					G.r += gauss1 * c2.r;
					w.x += gauss1;
					G.g += gauss2 * c2.g;
					w.y += gauss2;
				}
				v1 = IMG_NORM_PIXEL(tfm, st1).xy * texel;
			}
			G /= max(vec2(1.0), w);
			D = calcDiffBeforeConvolving ? G.x : (1.0 + p) * (G.r * 100.0) - p * (G.g * 100.0);
		} else {
			vec2 col = vec2(0.0);
			vec2 kernelSum = vec2(0.0);
			for (int y = -kernelRadius; y <= kernelRadius; ++y) {
				float c = IMG_NORM_PIXEL(dogH, uv + vec2(0, y) * texel).r;
				float gauss1 = gaussian(sigmaE, float(y));
				float gauss2 = gaussian(sigmaE * k, float(y));
				col.r += c * gauss1;
				kernelSum.r += gauss1;
				col.g += c * gauss2;
				kernelSum.g += gauss2;
			}
			D = (1.0 + p) * (col.r * 100.0) - p * (col.g * 100.0);
		}
		D = max(0.0, D);
		vec4 output = vec4(D);
		if (thresholding == 0) output /= 100.0;
		if (thresholding == 1) output = vec4((D >= threshold) ? 1.0 : 1.0 + tanh(phi * (D - threshold)));
		if (thresholding == 2) {
			float a = 1.0 / float(thresholds);
			float b = threshold / 100.0;
			float x = D / 100.0;
			output = vec4((x >= b) ? 1.0 : a * floor((pow(abs(x), phi) - (a * b / 2.0)) / (a * b) + 0.5));
		}
		if (thresholding == 3) {
			float x = D / 100.0;
			float qn = floor(x * float(thresholds) + 0.5) / float(thresholds);
			float qs = smoothstep(-2.0, 2.0, phi * (x - qn) * 10.0) - 0.5;
			output = vec4(qn + qs / float(thresholds));
		}
		gl_FragColor = saturate(output);
	} else if (PASSINDEX == 6) {
		if (smoothEdges) {
			float kernelSize = sigmaA * 2.0;
			vec4 G = IMG_NORM_PIXEL(dog, uv);
			float w = 1.0;
			vec2 v = IMG_NORM_PIXEL(tfm, uv).xy * texel;
			vec2 st0 = uv;
			vec2 v0 = v;
			for (int d = 1; float(d) <= kernelSize; ++d) {
				st0 += v0 * lineIntegralStep;
				vec4 c = IMG_NORM_PIXEL(dog, st0);
				float gauss1 = gaussian(sigmaA, float(d));
				G += gauss1 * c;
				w += gauss1;
				v0 = IMG_NORM_PIXEL(tfm, st0).xy * texel;
			}
			vec2 st1 = uv;
			vec2 v1 = v;
			for (int d = 1; float(d) <= kernelSize; ++d) {
				st1 -= v1 * lineIntegralStep;
				vec4 c = IMG_NORM_PIXEL(dog, st1);
				float gauss1 = gaussian(sigmaA, float(d));
				G += gauss1 * c;
				w += gauss1;
				v1 = IMG_NORM_PIXEL(tfm, st1).xy * texel;
			}
			gl_FragColor = G / max(1.0, w);
		} else {
			gl_FragColor = IMG_NORM_PIXEL(dog, uv);
		}
	} else {
		vec4 col = IMG_NORM_PIXEL(inputImage, uv);
		float D = IMG_NORM_PIXEL(dogAA, uv).r * termStrength;
		vec3 output;
		if (blendMode == 0) output = mix(minColor.rgb, maxColor.rgb, D);
		else if (blendMode == 1) output = mix(minColor.rgb, col.rgb, D);
		else {
			if (D < 0.5) output = mix(minColor.rgb, col.rgb, D * 2.0);
			else output = mix(col.rgb, maxColor.rgb, (D - 0.5) * 2.0);
		}
		gl_FragColor = vec4(saturate(mix(col.rgb, output, blendStrength)), 1.0);
	}
}
