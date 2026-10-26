/*{
	"DESCRIPTION": "Opens the frame as raw bytes with the wrong row width, byte offset or pixel size, like a hex-edited RAW or a decoder that guessed wrong: the picture shears into diagonals and colours cycle as channels slip across pixels.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Glitch", "Data"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "resolution", "LABEL": "Buffer width (px)", "TYPE": "float", "MIN": 64, "MAX": 1920, "DEFAULT": 480 },
		{ "NAME": "strideError", "LABEL": "Stride error (px)", "TYPE": "float", "MIN": -16, "MAX": 16, "DEFAULT": 3 },
		{ "NAME": "byteOffset", "LABEL": "Byte offset", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 1 },
		{ "NAME": "readAs", "LABEL": "Read as", "TYPE": "long", "VALUES": [3, 4], "LABELS": ["RGB (3 bytes)", "RGBA (4 bytes)"], "DEFAULT": 3 },
		{ "NAME": "drift", "LABEL": "Drift (bytes/s)", "TYPE": "float", "MIN": 0, "MAX": 2000, "DEFAULT": 0 }
	]
}*/

void main() {
	// The true buffer: a W×H image stored top-down, 3 bytes per pixel.
	float aspect = RENDERSIZE.y / RENDERSIZE.x;
	int W = int(floor(resolution));
	int H = max(1, int(floor(resolution * aspect)));
	ivec2 out_ = ivec2(isf_FragNormCoord.x * float(W), (1.0 - isf_FragNormCoord.y) * float(H));

	// The viewer thinks rows are W + error pixels of `readAs` bytes each.
	int viewW = max(1, W + int(strideError));
	int bppView = readAs;
	int byte = (out_.y * viewW + out_.x) * bppView + int(byteOffset) + int(TIME * drift);
	int total = W * H * 3;
	vec3 rgb;
	for (int c = 0; c < 3; c++) {
		int bi = ((byte + c) % total + total) % total;
		int p = bi / 3;
		int ch = bi - p * 3;
		vec2 at = (vec2(p % W, p / W) + 0.5) / vec2(W, H);
		vec3 s = IMG_NORM_PIXEL(inputImage, vec2(at.x, 1.0 - at.y)).rgb;
		rgb[c] = ch == 0 ? s.r : ch == 1 ? s.g : s.b;
	}
	gl_FragColor = vec4(rgb, 1.0);
}
