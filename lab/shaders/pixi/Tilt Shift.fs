/*{
	"DESCRIPTION": "Miniature-model tilt-shift: a sharp band between two lines, blurring out towards the frame edges, done as two separable passes. Port of the PixiJS TiltShiftFilter (itself from glfx.js); start/end points and blur are in fractions of the frame height.",
	"CREDIT": "PixiJS filters — TiltShiftFilter (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/pixijs/filters/tree/main/src/tilt-shift",
	"CATEGORIES": ["Blur", "Lens"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "blur", "LABEL": "Blur", "TYPE": "float", "MIN": 0, "MAX": 0.15, "DEFAULT": 0.05 },
		{ "NAME": "gradientBlur", "LABEL": "Gradient", "TYPE": "float", "MIN": 0.01, "MAX": 1, "DEFAULT": 0.35 },
		{ "NAME": "start", "LABEL": "Line start", "TYPE": "point2D", "MIN": [0, 0], "MAX": [1, 1], "DEFAULT": [0, 0.45] },
		{ "NAME": "end", "LABEL": "Line end", "TYPE": "point2D", "MIN": [0, 0], "MAX": [1, 1], "DEFAULT": [1, 0.45] }
	],
	"PASSES": [
		{ "TARGET": "blurX" },
		{ }
	]
}*/

float random(vec3 scale, float seed) {
	return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
}

vec4 tiltSample(sampler2D tex, vec2 delta) {
	vec2 uv = isf_FragNormCoord;
	vec2 px = uv * RENDERSIZE;
	vec2 s = start * RENDERSIZE;
	vec2 e = end * RENDERSIZE;
	vec2 normal = normalize(vec2(s.y - e.y, e.x - s.x));
	float radius = smoothstep(0.0, 1.0, abs(dot(px - s, normal)) / (gradientBlur * RENDERSIZE.y)) * blur * RENDERSIZE.y;
	float offset = random(vec3(12.9898, 78.233, 151.7182), 0.0);
	vec4 color = vec4(0.0);
	float total = 0.0;
	for (float t = -30.0; t <= 30.0; t++) {
		float percent = (t + offset - 0.5) / 30.0;
		float weight = 1.0 - abs(percent);
		color += texture(tex, uv + delta / RENDERSIZE * percent * radius) * weight;
		total += weight;
	}
	return color / total;
}

void main() {
	vec2 d = end - start;
	d *= RENDERSIZE;
	float len = max(length(d), 1e-4);
	vec2 along = d / len;
	if (PASSINDEX == 0) gl_FragColor = tiltSample(inputImage, along);
	else gl_FragColor = tiltSample(blurX, vec2(-along.y, along.x));
}
