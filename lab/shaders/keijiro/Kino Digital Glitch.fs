/*{
	"DESCRIPTION": "Blocky digital corruption: runs of random noise blocks displace the image, swap in stale 'trash' frames and shuffle colour channels. Port of KinoGlitch's DigitalGlitch; the CPU-filled noise texture is rebuilt on the GPU from hashed runs.",
	"CREDIT": "Keijiro Takahashi — KinoGlitch (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/keijiro/KinoGlitch",
	"CATEGORIES": ["Glitch", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "intensity", "LABEL": "Intensity", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.35 }
	],
	"PASSES": [
		{ "TARGET": "noiseTex", "WIDTH": 64, "HEIGHT": 32, "FILTER": "NEAREST" },
		{ "TARGET": "trash1", "PERSISTENT": true },
		{ "TARGET": "trash2", "PERSISTENT": true },
		{ }
	]
}*/

float hash(uint s) {
	s = s * 747796405u + 2891336453u;
	uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
	return float((w >> 22u) ^ w) / 4294967295.0;
}

// Unity's Update(): reseed the noise texture on a random subset of frames.
uint noiseSeed() {
	int f = FRAMEINDEX;
	float keep = mix(0.9, 0.5, intensity);
	for (int i = 0; i < 120; i++) {
		if (f <= 0 || hash(uint(f) * 9781u) > keep) break;
		f--;
	}
	return uint(max(f, 0)) * 7919u + 17u;
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (PASSINDEX == 0) {
		// UpdateNoiseTexture(): row-major runs, each texel starts a new run with p = 0.11.
		uint seed = noiseSeed();
		ivec2 p = ivec2(gl_FragCoord.xy);
		int idx = (31 - p.y) * 64 + p.x;
		int start = idx;
		for (int k = 0; k < 96; k++) {
			if (start <= 0 || hash(seed ^ uint(start) * 2654435761u) > 0.89) break;
			start--;
		}
		uint s = seed + uint(start) * 4u;
		gl_FragColor = vec4(hash(s), hash(s + 1u), hash(s + 2u), hash(s + 3u));
	} else if (PASSINDEX == 1) {
		gl_FragColor = FRAMEINDEX % 13 == 0 ? IMG_NORM_PIXEL(inputImage, uv) : IMG_NORM_PIXEL(trash1, uv);
	} else if (PASSINDEX == 2) {
		gl_FragColor = FRAMEINDEX % 73 == 0 ? IMG_NORM_PIXEL(inputImage, uv) : IMG_NORM_PIXEL(trash2, uv);
	} else {
		vec4 glitch = IMG_NORM_PIXEL(noiseTex, uv);
		float thresh = 1.001 - intensity * 1.001;
		float w_d = step(thresh, pow(glitch.z, 2.5));
		float w_f = step(thresh, pow(glitch.w, 2.5));
		float w_c = step(thresh, pow(glitch.z, 3.5));

		vec2 duv = fract(uv + glitch.xy * w_d);
		vec4 source = IMG_NORM_PIXEL(inputImage, duv);
		bool useFirst = hash(uint(FRAMEINDEX) * 31u + 5u) > 0.5;
		vec4 trash = useFirst ? IMG_NORM_PIXEL(trash1, duv) : IMG_NORM_PIXEL(trash2, duv);
		vec3 color = mix(source, trash, w_f).rgb;
		vec3 neg = clamp(color.grb + (1.0 - dot(color, vec3(1.0))) * 0.5, 0.0, 1.0);
		color = mix(color, neg, w_c);
		gl_FragColor = vec4(color, 1.0);
	}
}
