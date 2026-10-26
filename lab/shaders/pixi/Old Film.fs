/*{
	"DESCRIPTION": "Old film stock: sepia overlay, flickering vertical scratches, grain and a soft vignette, re-seeded every frame. Port of the PixiJS OldFilmFilter; its user-driven seed is driven by the frame counter here.",
	"CREDIT": "PixiJS filters — OldFilmFilter (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/pixijs/filters/tree/main/src/old-film",
	"CATEGORIES": ["Film", "Texture"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "sepia", "LABEL": "Sepia", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 },
		{ "NAME": "noise", "LABEL": "Noise", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 },
		{ "NAME": "noiseSize", "LABEL": "Noise size", "TYPE": "float", "MIN": 1, "MAX": 10, "DEFAULT": 1 },
		{ "NAME": "scratch", "LABEL": "Scratch", "TYPE": "float", "MIN": -1, "MAX": 1, "DEFAULT": 0.5 },
		{ "NAME": "scratchDensity", "LABEL": "Scratch density", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 },
		{ "NAME": "scratchWidth", "LABEL": "Scratch width", "TYPE": "float", "MIN": 1, "MAX": 20, "DEFAULT": 1 },
		{ "NAME": "vignetting", "LABEL": "Vignetting", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 },
		{ "NAME": "vignettingAlpha", "LABEL": "Vignetting alpha", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 1 },
		{ "NAME": "vignettingBlur", "LABEL": "Vignetting blur", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 }
	]
}*/

const float SQRT_2 = 1.414213;
const vec3 SEPIA_RGB = vec3(112.0 / 255.0, 66.0 / 255.0, 20.0 / 255.0);

float rand(vec2 co) {
	return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 Overlay(vec3 src, vec3 dst) {
	return vec3(
		(dst.x <= 0.5) ? (2.0 * src.x * dst.x) : (1.0 - 2.0 * (1.0 - dst.x) * (1.0 - src.x)),
		(dst.y <= 0.5) ? (2.0 * src.y * dst.y) : (1.0 - 2.0 * (1.0 - dst.y) * (1.0 - src.y)),
		(dst.z <= 0.5) ? (2.0 * src.z * dst.z) : (1.0 - 2.0 * (1.0 - dst.z) * (1.0 - src.z)));
}

void main() {
	vec2 coord = isf_FragNormCoord;
	vec3 color = IMG_NORM_PIXEL(inputImage, coord).rgb;
	float uSeed = rand(vec2(float(FRAMEINDEX % 4096), 0.37));

	if (sepia > 0.0) {
		vec3 grayscale = vec3((color.x + color.y + color.z) / 3.0);
		color = grayscale + sepia * (Overlay(SEPIA_RGB, grayscale) - grayscale);
	}

	if (vignetting > 0.0) {
		float outter = SQRT_2 - vignetting * SQRT_2;
		vec2 dir = vec2(0.5) - coord;
		dir.y *= RENDERSIZE.y / RENDERSIZE.x;
		float darker = clamp((outter - length(dir) * SQRT_2) / (0.00001 + vignettingBlur * SQRT_2), 0.0, 1.0);
		color *= darker + (1.0 - darker) * (1.0 - vignettingAlpha);
	}

	if (scratchDensity > uSeed && scratch != 0.0) {
		float phase = uSeed * 256.0;
		float s = mod(floor(phase), 2.0);
		float dist = 1.0 / scratchDensity;
		float d = distance(coord, vec2(uSeed * dist, abs(s - uSeed * dist)));
		if (d < uSeed * 0.6 + 0.4) {
			float period = scratchDensity * 10.0;
			float xx = coord.x * period + phase;
			float aa = abs(mod(xx, 0.5) * 4.0);
			float bb = mod(floor(xx / 0.5), 2.0);
			float yy = (1.0 - bb) * aa + bb * (2.0 - aa);
			float kk = 2.0 * period;
			float dw = scratchWidth / RENDERSIZE.x * (0.75 + uSeed);
			float dh = dw * kk;
			float tine = yy - (2.0 - dh);
			if (tine > 0.0) {
				float _sign = sign(scratch);
				tine = s * tine / period + scratch + 0.1;
				tine = clamp(tine + 1.0, 0.5 + _sign * 0.5, 1.5 + _sign * 0.5);
				color *= tine;
			}
		}
	}

	if (noise > 0.0 && noiseSize > 0.0) {
		vec2 pixelCoord = floor(gl_FragCoord.xy / noiseSize);
		color += (rand(pixelCoord * noiseSize * uSeed) - 0.5) * noise;
	}
	gl_FragColor = vec4(color, 1.0);
}
