/*{
	"DESCRIPTION": "Flatbed-scanner capture of live footage: a lit scan bar sweeps across and only the strip under it is recorded, so moving subjects stretch, warp and repeat. Behind the bar is the finished scan; ahead of it is the live picture, blank paper, or the bar's own line smeared out.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Time", "Distortion"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "sweepTime", "LABEL": "Sweep time (s)", "TYPE": "float", "MIN": 0.5, "MAX": 20, "DEFAULT": 4 },
		{ "NAME": "direction", "LABEL": "Direction", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["Top → bottom", "Bottom → top", "Left → right", "Right → left"], "DEFAULT": 0 },
		{ "NAME": "ahead", "LABEL": "Ahead of bar", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["Live", "Paper", "Smear"], "DEFAULT": 0 },
		{ "NAME": "lamp", "LABEL": "Lamp", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.6 },
		{ "NAME": "lampColor", "LABEL": "Lamp colour", "TYPE": "color", "DEFAULT": [0.75, 0.9, 1, 1] }
	],
	"PASSES": [
		{ "TARGET": "scan", "PERSISTENT": true },
		{ }
	]
}*/

// 0 at the start of the sweep, 1 at the end.
float along(vec2 uv) {
	if (direction == 1) return uv.y;
	if (direction == 2) return uv.x;
	if (direction == 3) return 1.0 - uv.x;
	return 1.0 - uv.y;
}
vec2 fromAlong(vec2 uv, float a) {
	if (direction == 1) return vec2(uv.x, a);
	if (direction == 2) return vec2(a, uv.y);
	if (direction == 3) return vec2(1.0 - a, uv.y);
	return vec2(uv.x, 1.0 - a);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float speed = 1.0 / max(sweepTime, 0.01);
	float bar = fract(TIME * speed);
	float prev = fract(max(TIME - max(TIMEDELTA, 1.0 / 120.0), 0.0) * speed);
	float a = along(uv);
	if (PASSINDEX == 0) {
		bool covered = prev <= bar ? (a >= prev && a <= bar) : (a >= prev || a <= bar);
		// A new sweep starts on a clean sheet.
		bool reset = prev > bar && a > bar;
		vec4 keep = FRAMEINDEX == 0 || reset ? vec4(0.92, 0.92, 0.9, 1.0) : IMG_NORM_PIXEL(scan, uv);
		gl_FragColor = covered ? IMG_NORM_PIXEL(inputImage, uv) : keep;
		return;
	}
	vec3 col;
	if (a <= bar) col = IMG_NORM_PIXEL(scan, uv).rgb;
	else if (ahead == 1) col = vec3(0.92, 0.92, 0.9);
	else if (ahead == 2) col = IMG_NORM_PIXEL(inputImage, fromAlong(uv, bar)).rgb;
	else col = IMG_NORM_PIXEL(inputImage, uv).rgb * 0.75;

	float px = 1.0 / (direction >= 2 ? RENDERSIZE.x : RENDERSIZE.y);
	float d = (a - bar) / px;
	float glow = exp(-d * d / 18.0) + 0.35 * exp(-abs(d) / 40.0);
	col += lampColor.rgb * glow * lamp;
	gl_FragColor = vec4(col, 1.0);
}
