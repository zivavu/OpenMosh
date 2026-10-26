/*{
	"DESCRIPTION": "Real JPEG damage: the picture goes through an actual 8×8 DCT in YCbCr, gets quantised with the standard JPEG tables at the chosen quality, and decodes back with ringing and blocking. Glitch borrows AC coefficients from other blocks, flattens or transposes some and swaps chroma, the way a corrupt bitstream does.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Glitch", "Compression"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "quality", "LABEL": "Quality", "TYPE": "float", "MIN": 1, "MAX": 100, "DEFAULT": 8 },
		{ "NAME": "blockScale", "LABEL": "Block scale", "TYPE": "float", "MIN": 1, "MAX": 8, "DEFAULT": 2 },
		{ "NAME": "chromaBoost", "LABEL": "Chroma crush", "TYPE": "float", "MIN": 1, "MAX": 6, "DEFAULT": 2 },
		{ "NAME": "glitch", "LABEL": "Glitch", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.15 },
		{ "NAME": "rate", "LABEL": "Glitch rate (Hz)", "TYPE": "float", "MIN": 0, "MAX": 30, "DEFAULT": 6 }
	],
	"PASSES": [
		{ "TARGET": "coef", "FLOAT": true, "FILTER": "NEAREST", "WIDTH": "floor($WIDTH / max(1.0, floor($blockScale)))", "HEIGHT": "floor($HEIGHT / max(1.0, floor($blockScale)))" },
		{ }
	]
}*/

const float PI = 3.14159265359;

// ITU T.81 Annex K tables, row-major (v * 8 + u).
const float QY[64] = float[64](
	16., 11., 10., 16., 24., 40., 51., 61., 12., 12., 14., 19., 26., 58., 60., 55.,
	14., 13., 16., 24., 40., 57., 69., 56., 14., 17., 22., 29., 51., 87., 80., 62.,
	18., 22., 37., 56., 68., 109., 103., 77., 24., 35., 55., 64., 81., 104., 113., 92.,
	49., 64., 78., 87., 103., 121., 120., 101., 72., 92., 95., 98., 112., 100., 103., 99.);
const float QC[64] = float[64](
	17., 18., 24., 47., 99., 99., 99., 99., 18., 21., 26., 66., 99., 99., 99., 99.,
	24., 26., 56., 99., 99., 99., 99., 99., 47., 66., 99., 99., 99., 99., 99., 99.,
	99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99.,
	99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99.);

float hash(uint s) {
	s = s * 747796405u + 2891336453u;
	uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
	return float((w >> 22u) ^ w) / 4294967295.0;
}

float qscale() {
	float q = clamp(quality, 1.0, 100.0);
	return q < 50.0 ? 5000.0 / q : 200.0 - 2.0 * q;
}
float quant(float base, float s) { return clamp(floor((base * s + 50.0) / 100.0), 1.0, 255.0); }

vec3 toYCC(vec3 rgb) {
	rgb *= 255.0;
	return vec3(
		0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b - 128.0,
		-0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b,
		0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b);
}
vec3 toRGB(vec3 ycc) {
	float y = ycc.x + 128.0;
	return vec3(y + 1.402 * ycc.z, y - 0.344136 * ycc.y - 0.714136 * ycc.z, y + 1.772 * ycc.y) / 255.0;
}

float C(int k) { return k == 0 ? 0.70710678 : 1.0; }

void main() {
	if (PASSINDEX == 0) {
		// One texel per coefficient: texel (u, v) of each 8×8 tile holds F(u, v) of that block.
		ivec2 g = ivec2(gl_FragCoord.xy);
		ivec2 block = g / 8;
		ivec2 uv = g - block * 8;
		vec3 acc = vec3(0.0);
		for (int y = 0; y < 8; y++) {
			float cy = cos(float(2 * y + 1) * float(uv.y) * PI / 16.0);
			for (int x = 0; x < 8; x++) {
				vec2 p = (vec2(block * 8 + ivec2(x, y)) + 0.5) / RENDERSIZE;
				vec3 f = toYCC(clamp(IMG_NORM_PIXEL(inputImage, p).rgb, 0.0, 1.0));
				acc += f * cos(float(2 * x + 1) * float(uv.x) * PI / 16.0) * cy;
			}
		}
		acc *= 0.25 * C(uv.x) * C(uv.y);
		float s = qscale();
		int i = uv.y * 8 + uv.x;
		float qy = quant(QY[i], s);
		float qc = quant(QC[i], s * chromaBoost);
		gl_FragColor = vec4(round(acc.x / qy) * qy, round(acc.yz / qc) * qc, 1.0);
		return;
	}

	ivec2 coefSize = ivec2(IMG_SIZE(coef));
	float scale = max(1.0, floor(blockScale));
	ivec2 g = min(ivec2(gl_FragCoord.xy / scale), coefSize - 1);
	ivec2 block = g / 8;
	ivec2 xy = g - block * 8;
	ivec2 blocks = max(coefSize / 8, ivec2(1));

	// Corrupt blocks pick one failure, re-rolled `rate` times a second.
	uint seed = uint(floor(TIME * rate)) * 7919u;
	uint bid = uint(block.y * 4096 + block.x) * 2654435761u ^ seed;
	bool hit = hash(bid) < glitch * glitch;
	float kind = hash(bid + 11u);
	ivec2 acFrom = block;
	if (hit && kind < 0.45) {
		ivec2 jump = ivec2(floor((vec2(hash(bid + 3u), hash(bid + 5u)) - 0.5) * 12.0));
		acFrom = clamp(block + jump, ivec2(0), blocks - 1);
	}
	bool flatten = hit && kind >= 0.45 && kind < 0.65;
	bool transpose = hit && kind >= 0.65 && kind < 0.85;
	bool chromaSwap = hit && kind >= 0.85;

	vec3 f = vec3(0.0);
	for (int v = 0; v < 8; v++) {
		float cv = C(v) * cos(float(2 * xy.y + 1) * float(v) * PI / 16.0);
		for (int u = 0; u < 8; u++) {
			if (flatten && (u + v) > 0) continue;
			ivec2 k = transpose ? ivec2(v, u) : ivec2(u, v);
			ivec2 src = (u + v) == 0 ? block : acFrom;
			vec3 F = texelFetch(coef, min(src * 8 + k, coefSize - 1), 0).rgb;
			f += F * C(u) * cv * cos(float(2 * xy.x + 1) * float(u) * PI / 16.0);
		}
	}
	f *= 0.25;
	if (chromaSwap) f.yz = f.zy * vec2(-1.6, 1.6);
	gl_FragColor = vec4(clamp(toRGB(f), 0.0, 1.0), 1.0);
}
