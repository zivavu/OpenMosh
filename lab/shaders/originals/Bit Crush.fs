/*{
	"DESCRIPTION": "Damage at the bit level: each 8-bit channel gets its low bits cut, its bits rotated, a higher bit plane XORed into a lower one, its bit order reversed, or Gray-coded. Channels can be offset from each other so the damage tears colour apart.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Glitch", "Color"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "mode", "LABEL": "Operation", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Truncate", "Rotate", "XOR planes", "Reverse bits", "Gray code"], "DEFAULT": 2 },
		{ "NAME": "bits", "LABEL": "Bits kept", "TYPE": "float", "MIN": 1, "MAX": 8, "DEFAULT": 6 },
		{ "NAME": "amount", "LABEL": "Shift", "TYPE": "float", "MIN": 0, "MAX": 7, "DEFAULT": 3 },
		{ "NAME": "channelOffset", "LABEL": "Channel offset", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 1 },
		{ "NAME": "mixAmount", "LABEL": "Mix", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 1 }
	]
}*/

uint rotl8(uint v, uint n) {
	n &= 7u;
	return ((v << n) | (v >> ((8u - n) & 7u))) & 255u;
}

uint reverse8(uint v) {
	v = ((v & 0xF0u) >> 4) | ((v & 0x0Fu) << 4);
	v = ((v & 0xCCu) >> 2) | ((v & 0x33u) << 2);
	v = ((v & 0xAAu) >> 1) | ((v & 0x55u) << 1);
	return v;
}

uint crush(uint v, uint shift) {
	uint keep = uint(clamp(floor(bits), 1.0, 8.0));
	uint mask = (255u << (8u - keep)) & 255u;
	if (mode == 1) v = rotl8(v, shift);
	else if (mode == 2) v ^= (v << shift) & 255u;
	else if (mode == 3) v = rotl8(reverse8(v), shift);
	else if (mode == 4) v ^= v >> max(shift, 1u);
	return v & mask;
}

void main() {
	vec3 src = IMG_THIS_NORM_PIXEL(inputImage).rgb;
	uvec3 b = uvec3(clamp(src, 0.0, 1.0) * 255.0 + 0.5);
	uint s = uint(floor(amount));
	uint o = uint(floor(channelOffset));
	uvec3 r = uvec3(crush(b.r, s), crush(b.g, s + o), crush(b.b, s + 2u * o));
	gl_FragColor = vec4(mix(src, vec3(r) / 255.0, mixAmount), 1.0);
}
