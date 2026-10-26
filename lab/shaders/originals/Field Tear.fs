/*{
	"DESCRIPTION": "Broken interlacing: alternate lines come from an older field, so anything moving combs apart. Odd fields slide sideways, now and then freeze for a beat, and can sit half a line off, like a bad deinterlacer or a dropped field.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Time", "Glitch", "Video"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "lineHeight", "LABEL": "Line height (px)", "TYPE": "float", "MIN": 1, "MAX": 16, "DEFAULT": 2 },
		{ "NAME": "fieldDelay", "LABEL": "Field delay (frames)", "TYPE": "float", "MIN": 1, "MAX": 12, "DEFAULT": 3 },
		{ "NAME": "shift", "LABEL": "Field shift", "TYPE": "float", "MIN": -0.1, "MAX": 0.1, "DEFAULT": 0.012 },
		{ "NAME": "jitter", "LABEL": "Line jitter", "TYPE": "float", "MIN": 0, "MAX": 0.05, "DEFAULT": 0.004 },
		{ "NAME": "freeze", "LABEL": "Field freeze", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.25 },
		{ "NAME": "tint", "LABEL": "Field tint", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 }
	],
	"PASSES": [
		{ "TARGET": "field", "PERSISTENT": true },
		{ }
	]
}*/

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
	vec2 uv = isf_FragNormCoord;
	// Freezes come in beats of ~0.4 s; while frozen the old field stops updating.
	float beat = floor(TIME * 2.5);
	bool frozen = hash(beat + 3.7) < freeze * 0.6;
	if (PASSINDEX == 0) {
		bool update = FRAMEINDEX % max(1, int(fieldDelay)) == 0 && !frozen;
		gl_FragColor = (update || FRAMEINDEX == 0) ? IMG_NORM_PIXEL(inputImage, uv) : IMG_NORM_PIXEL(field, uv);
		return;
	}
	float line = floor(gl_FragCoord.y / max(1.0, floor(lineHeight)));
	bool odd = mod(line, 2.0) > 0.5;
	if (!odd) {
		gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
		return;
	}
	float j = (hash(line * 1.31 + floor(TIME * 24.0)) - 0.5) * 2.0 * jitter;
	float wobble = frozen ? (hash(beat) - 0.5) * 0.03 : 0.0;
	vec2 at = uv + vec2(shift + j + wobble, 0.0);
	vec3 col = IMG_NORM_PIXEL(field, at).rgb;
	// Older field drifts towards a cool cast, like mismatched chroma timing.
	col = mix(col, col * vec3(0.85, 0.95, 1.15), tint);
	gl_FragColor = vec4(col, 1.0);
}
