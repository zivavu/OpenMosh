/*{
	"DESCRIPTION": "Kuwahara painterly filter in three flavours: basic (4 quadrants), generalized (8 gaussian-weighted sectors) and anisotropic (sectors stretched along the local structure tensor). Port of AcerolaFX_KuwaharaFilter, compute passes rewritten as fragment passes.",
	"CREDIT": "Garrett Gunnell (Acerola) — AcerolaFX (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/GarrettGunnell/AcerolaFX/blob/main/Shaders/AcerolaFX_KuwaharaFilter.fx",
	"CATEGORIES": ["Stylize", "Blur", "Acerola"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "filterType", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["Basic", "Generalized", "Anisotropic"], "DEFAULT": 2 },
		{ "NAME": "kernelSize", "TYPE": "long", "MIN": 2, "MAX": 30, "DEFAULT": 8, "LABEL": "Radius" },
		{ "NAME": "sharpness", "TYPE": "float", "MIN": 0.0, "MAX": 18.0, "DEFAULT": 8.0 },
		{ "NAME": "blurRadius", "TYPE": "long", "MIN": 1, "MAX": 6, "DEFAULT": 2, "LABEL": "Tensor blur radius" },
		{ "NAME": "alpha", "TYPE": "float", "MIN": 0.01, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Anisotropy alpha" },
		{ "NAME": "zeroCrossing", "TYPE": "float", "MIN": 0.01, "MAX": 2.0, "DEFAULT": 0.58 }
	],
	"PASSES": [
		{ "TARGET": "sectors", "WIDTH": "32", "HEIGHT": "32", "FLOAT": true },
		{ "TARGET": "k0", "WIDTH": "32", "HEIGHT": "32", "FLOAT": true },
		{ "TARGET": "tensor", "FLOAT": true },
		{ "TARGET": "tensorH", "FLOAT": true },
		{ "TARGET": "tfm", "FLOAT": true },
		{}
	]
}*/

#define PI 3.14159265358979
#define N 8

float luminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 fetchSrc(vec2 px) { return IMG_PIXEL(inputImage, px).rgb; }

float gaussian2(float sigma, vec2 pos) {
	return (1.0 / (2.0 * PI * sigma * sigma)) * exp(-((pos.x * pos.x + pos.y * pos.y) / (2.0 * sigma * sigma)));
}
float gaussian1(float sigma, float pos) {
	return (1.0 / sqrt(2.0 * PI * sigma * sigma)) * exp(-(pos * pos) / (2.0 * sigma * sigma));
}

// --- Basic ---------------------------------------------------------------
vec4 sampleQuadrant(vec2 px, int x1, int x2, int y1, int y2, float n) {
	float luminanceSum = 0.0;
	float luminanceSum2 = 0.0;
	vec3 colSum = vec3(0.0);
	for (int x = x1; x <= x2; ++x) {
		for (int y = y1; y <= y2; ++y) {
			vec3 c = fetchSrc(px + vec2(x, y));
			float l = luminance(c);
			luminanceSum += l;
			luminanceSum2 += l * l;
			colSum += c;
		}
	}
	float mean = luminanceSum / n;
	float stdev = abs(luminanceSum2 / n - mean * mean);
	return vec4(colSum / n, stdev);
}

vec4 basic(vec2 px) {
	int radius = kernelSize / 2;
	float windowSize = 2.0 * float(radius) + 1.0;
	int quadrantSize = int(ceil(windowSize / 2.0));
	float numSamples = float(quadrantSize * quadrantSize);
	vec4 q1 = sampleQuadrant(px, -radius, 0, -radius, 0, numSamples);
	vec4 q2 = sampleQuadrant(px, 0, radius, -radius, 0, numSamples);
	vec4 q3 = sampleQuadrant(px, 0, radius, 0, radius, numSamples);
	vec4 q4 = sampleQuadrant(px, -radius, 0, 0, radius, numSamples);
	float minstd = min(q1.a, min(q2.a, min(q3.a, q4.a)));
	vec4 q = vec4(equal(vec4(q1.a, q2.a, q3.a, q4.a), vec4(minstd)));
	if (dot(q, vec4(1.0)) > 1.0)
		return vec4((q1.rgb + q2.rgb + q3.rgb + q4.rgb) / 4.0, 1.0);
	return vec4(q1.rgb * q.x + q2.rgb * q.y + q3.rgb * q.z + q4.rgb * q.w, 1.0);
}

// --- Generalized -----------------------------------------------------------
vec4 generalized(vec2 px) {
	vec4 m[N];
	vec3 s[N];
	int radius = kernelSize / 2;
	for (int k = 0; k < N; ++k) {
		m[k] = vec4(0.0);
		s[k] = vec3(0.0);
	}
	float piN = 2.0 * PI / float(N);
	mat2 X = mat2(cos(piN), sin(piN), -sin(piN), cos(piN));
	for (int x = -radius; x <= radius; ++x) {
		for (int y = -radius; y <= radius; ++y) {
			vec2 v = 0.5 * vec2(x, y) / float(radius);
			vec3 c = fetchSrc(px + vec2(x, y));
			for (int k = 0; k < N; ++k) {
				float w = IMG_NORM_PIXEL(k0, 0.5 + v).x;
				m[k] += vec4(c * w, w);
				s[k] += c * c * w;
				v = v * X;
			}
		}
	}
	vec4 result = vec4(0.0);
	for (int k = 0; k < N; ++k) {
		m[k].rgb /= m[k].w;
		s[k] = abs(s[k] / m[k].w - m[k].rgb * m[k].rgb);
		float sigma2 = s[k].r + s[k].g + s[k].b;
		float w = 1.0 / (1.0 + pow(abs(1000.0 * sigma2), 0.5 * sharpness));
		result += vec4(m[k].rgb * w, w);
	}
	return result / result.w;
}

// --- Anisotropic -----------------------------------------------------------
vec4 anisotropic(vec2 px) {
	vec4 t = IMG_PIXEL(tfm, px);
	int radius = kernelSize / 2;
	float a = float(radius) * clamp((alpha + t.w) / alpha, 0.1, 2.0);
	float b = float(radius) * clamp(alpha / (alpha + t.w), 0.1, 2.0);
	float cos_phi = cos(t.z);
	float sin_phi = sin(t.z);
	// HLSL mul(M, v) with row-built matrices == GLSL v * M with the same arguments.
	mat2 R = mat2(cos_phi, -sin_phi, sin_phi, cos_phi);
	mat2 S = mat2(0.5 / a, 0.0, 0.0, 0.5 / b);
	int max_x = int(sqrt(a * a * cos_phi * cos_phi + b * b * sin_phi * sin_phi));
	int max_y = int(sqrt(a * a * sin_phi * sin_phi + b * b * cos_phi * cos_phi));
	float zeta = 2.0 / float(kernelSize / 2);
	float sinZeroCross = sin(zeroCrossing);
	float eta = (zeta + cos(zeroCrossing)) / (sinZeroCross * sinZeroCross);
	vec4 m[N];
	vec3 s[N];
	for (int k = 0; k < N; ++k) {
		m[k] = vec4(0.0);
		s[k] = vec3(0.0);
	}
	for (int y = -max_y; y <= max_y; ++y) {
		for (int x = -max_x; x <= max_x; ++x) {
			vec2 v = (vec2(x, y) * R) * S;
			if (dot(v, v) <= 0.25) {
				vec3 c = fetchSrc(px + vec2(x, y));
				float sum = 0.0;
				float w[8];
				float z, vxx, vyy;
				vxx = zeta - eta * v.x * v.x;
				vyy = zeta - eta * v.y * v.y;
				z = max(0.0, v.y + vxx); w[0] = z * z; sum += w[0];
				z = max(0.0, -v.x + vyy); w[2] = z * z; sum += w[2];
				z = max(0.0, -v.y + vxx); w[4] = z * z; sum += w[4];
				z = max(0.0, v.x + vyy); w[6] = z * z; sum += w[6];
				v = sqrt(2.0) / 2.0 * vec2(v.x - v.y, v.x + v.y);
				vxx = zeta - eta * v.x * v.x;
				vyy = zeta - eta * v.y * v.y;
				z = max(0.0, v.y + vxx); w[1] = z * z; sum += w[1];
				z = max(0.0, -v.x + vyy); w[3] = z * z; sum += w[3];
				z = max(0.0, -v.y + vxx); w[5] = z * z; sum += w[5];
				z = max(0.0, v.x + vyy); w[7] = z * z; sum += w[7];
				float g = exp(-3.125 * dot(v, v)) / sum;
				for (int k = 0; k < 8; ++k) {
					float wk = w[k] * g;
					m[k] += vec4(c * wk, wk);
					s[k] += c * c * wk;
				}
			}
		}
	}
	vec4 result = vec4(0.0);
	for (int k = 0; k < N; ++k) {
		m[k].rgb /= m[k].w;
		s[k] = abs(s[k] / m[k].w - m[k].rgb * m[k].rgb);
		float sigma2 = s[k].r + s[k].g + s[k].b;
		float w = 1.0 / (1.0 + pow(abs(1000.0 * sigma2), 0.5 * sharpness));
		result += vec4(m[k].rgb * w, w);
	}
	return result / result.w;
}

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 px = gl_FragCoord.xy;
	if (PASSINDEX == 0) {
		// Sector mask for the generalized kernel.
		vec2 pos = uv - 0.5;
		float phi = atan(pos.y, pos.x);
		float Xk = ((-PI / float(N)) < phi && phi <= (PI / float(N))) ? 1.0 : 0.0;
		gl_FragColor = vec4(dot(pos, pos) <= 0.25 ? Xk : 0.0);
	} else if (PASSINDEX == 1) {
		// Gaussian-smoothed sector weights.
		float sigmaR = 0.5 * 32.0 * 0.5;
		float sigmaS = 0.33 * sigmaR;
		float weight = 0.0;
		float kernelSum = 0.0;
		int r = int(floor(sigmaS));
		for (int x = -r; x <= r; ++x) {
			for (int y = -r; y <= r; ++y) {
				float c = IMG_NORM_PIXEL(sectors, uv + vec2(x, y) / 32.0).r;
				float gauss = gaussian2(sigmaS, vec2(x, y));
				weight += c * gauss;
				kernelSum += gauss;
			}
		}
		gl_FragColor = vec4((weight / kernelSum) * gaussian2(sigmaR, (uv - 0.5) * sigmaR * 5.0));
	} else if (PASSINDEX == 2) {
		// Structure tensor from Sobel of the source.
		vec2 d = vec2(1.0);
		vec3 Sx = (
			 1.0 * fetchSrc(px + vec2(-d.x, -d.y)) +
			 2.0 * fetchSrc(px + vec2(-d.x, 0.0)) +
			 1.0 * fetchSrc(px + vec2(-d.x, d.y)) +
			-1.0 * fetchSrc(px + vec2(d.x, -d.y)) +
			-2.0 * fetchSrc(px + vec2(d.x, 0.0)) +
			-1.0 * fetchSrc(px + vec2(d.x, d.y))) / 4.0;
		vec3 Sy = (
			 1.0 * fetchSrc(px + vec2(-d.x, -d.y)) +
			 2.0 * fetchSrc(px + vec2(0.0, -d.y)) +
			 1.0 * fetchSrc(px + vec2(d.x, -d.y)) +
			-1.0 * fetchSrc(px + vec2(-d.x, d.y)) +
			-2.0 * fetchSrc(px + vec2(0.0, d.y)) +
			-1.0 * fetchSrc(px + vec2(d.x, d.y))) / 4.0;
		gl_FragColor = vec4(dot(Sx, Sx), dot(Sy, Sy), dot(Sx, Sy), 1.0);
	} else if (PASSINDEX == 3) {
		vec4 col = vec4(0.0);
		float kernelSum = 0.0;
		for (int x = -blurRadius; x <= blurRadius; ++x) {
			vec4 c = IMG_PIXEL(tensor, px + vec2(x, 0));
			float gauss = gaussian1(2.0, float(x));
			col += c * gauss;
			kernelSum += gauss;
		}
		gl_FragColor = col / kernelSum;
	} else if (PASSINDEX == 4) {
		vec4 col = vec4(0.0);
		float kernelSum = 0.0;
		for (int y = -blurRadius; y <= blurRadius; ++y) {
			vec4 c = IMG_PIXEL(tensorH, px + vec2(0, y));
			float gauss = gaussian1(2.0, float(y));
			col += c * gauss;
			kernelSum += gauss;
		}
		vec3 g = col.rgb / kernelSum;
		float disc = sqrt(max(0.0, g.y * g.y - 2.0 * g.x * g.y + g.x * g.x + 4.0 * g.z * g.z));
		float lambda1 = 0.5 * (g.y + g.x + disc);
		float lambda2 = 0.5 * (g.y + g.x - disc);
		vec2 v = vec2(lambda1 - g.x, -g.z);
		vec2 t = length(v) > 0.0 ? normalize(v) : vec2(0.0, 1.0);
		float phi = -atan(t.y, t.x);
		float A = (lambda1 + lambda2 > 0.0) ? (lambda1 - lambda2) / (lambda1 + lambda2) : 0.0;
		gl_FragColor = vec4(t, phi, A);
	} else {
		if (filterType == 0) gl_FragColor = basic(px);
		else if (filterType == 1) gl_FragColor = generalized(px);
		else gl_FragColor = anisotropic(px);
		gl_FragColor.a = 1.0;
	}
}
