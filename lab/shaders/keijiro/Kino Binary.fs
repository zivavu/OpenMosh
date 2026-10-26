/*{
	"DESCRIPTION": "1-bit look: luminance against an ordered-dither threshold picks one of two inks. Port of KinoBinary; the dither textures are computed in the shader, and its 64×64 blue-noise texture is stood in for by interleaved gradient noise.",
	"CREDIT": "Keijiro Takahashi — KinoBinary (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/keijiro/KinoBinary",
	"CATEGORIES": ["Color", "Retro", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "ditherType", "LABEL": "Dither", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Bayer 2×2", "Bayer 3×3", "Bayer 4×4", "Bayer 8×8", "Noise (IGN)"], "DEFAULT": 3 },
		{ "NAME": "ditherScale", "LABEL": "Scale", "TYPE": "float", "MIN": 1, "MAX": 8, "DEFAULT": 2 },
		{ "NAME": "color0", "LABEL": "Dark ink", "TYPE": "color", "DEFAULT": [0.08, 0.05, 0.2, 1] },
		{ "NAME": "color1", "LABEL": "Light ink", "TYPE": "color", "DEFAULT": [1, 0.93, 0.78, 1] },
		{ "NAME": "opacity", "LABEL": "Opacity", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 1 }
	]
}*/

float threshold(ivec2 p) {
	if (ditherType == 1) {
		const float b3[9] = float[9](0.0, 7.0, 3.0, 6.0, 5.0, 2.0, 4.0, 1.0, 8.0);
		ivec2 q = p % 3;
		return (b3[q.y * 3 + q.x] + 0.5) / 9.0;
	}
	if (ditherType == 4) {
		vec2 f = vec2(p);
		return fract(52.9829189 * fract(dot(f, vec2(0.06711056, 0.00583715))));
	}
	int levels = ditherType == 0 ? 1 : ditherType == 2 ? 2 : 3;
	float n = float(1 << (2 * levels));
	// Bit-reversed interleave gives the classic Bayer ordering.
	float v = 0.0;
	for (int i = 0; i < 3; i++) {
		if (i >= levels) break;
		ivec2 q = (p >> i) & 1;
		v += float(((q.x ^ q.y) << 1) | q.y) * pow(4.0, float(levels - 1 - i));
	}
	return (v + 0.5) / n;
}

void main() {
	vec4 source = IMG_THIS_NORM_PIXEL(inputImage);
	ivec2 p = ivec2(gl_FragCoord.xy / max(1.0, floor(ditherScale)));
	float dither = threshold(p);
	vec3 lin = pow(clamp(source.rgb, 0.0, 1.0), vec3(2.2));
	float rlum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
	vec3 rgb = rlum < dither ? color0.rgb : color1.rgb;
	gl_FragColor = vec4(mix(source.rgb, rgb, opacity), 1.0);
}
