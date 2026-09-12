/*{
	"DESCRIPTION": "Old-school video feedback: the composited frame is re-injected through a rotate/scale/offset transform with hue shift and tint, building trails. Port of KinoFeedback.",
	"CREDIT": "Keijiro Takahashi — KinoFeedback (port)",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/KinoFeedbackURP",
	"CATEGORIES": ["Feedback", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "rotation", "LABEL": "Rotation (°/s)", "TYPE": "float", "MIN": -180, "MAX": 180, "DEFAULT": 15 },
		{ "NAME": "scale", "LABEL": "Scale", "TYPE": "float", "MIN": 0.9, "MAX": 1.1, "DEFAULT": 1.01 },
		{ "NAME": "offset", "LABEL": "Offset", "TYPE": "point2D", "MIN": [-0.1, -0.1], "MAX": [0.1, 0.1], "DEFAULT": [0, 0] },
		{ "NAME": "hue", "LABEL": "Hue shift", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.02 },
		{ "NAME": "tint", "LABEL": "Tint", "TYPE": "color", "DEFAULT": [1, 1, 1, 1] },
		{ "NAME": "amount", "LABEL": "Amount", "TYPE": "float", "MIN": 0, "MAX": 0.95, "DEFAULT": 0.35 }
	],
	"PASSES": [
		{ "TARGET": "ghost", "PERSISTENT": true },
		{ "TARGET": "scene", "PERSISTENT": true },
		{ }
	]
}*/

vec3 RgbToHsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 HsvToRgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (PASSINDEX == 0) {
		// Injection: transform the previous composite (Feedback.shader).
		vec2 c = (uv - 0.5) * scale;
		float a = radians(rotation) * TIMEDELTA;
		float s = sin(a);
		float co = cos(a);
		c = mat2(co, -s, s, co) * c;
		vec3 rgb = IMG_NORM_PIXEL(scene, c + 0.5 + offset).rgb;
		vec3 hsv = RgbToHsv(clamp(rgb, 0.0, 1.0));
		hsv.x = fract(hsv.x + hue);
		gl_FragColor = vec4(clamp(HsvToRgb(hsv) * tint.rgb, 0.0, 1.0), 1.0);
	} else if (PASSINDEX == 1) {
		// Capture: composite input + injected feedback; the next frame re-injects this.
		vec3 ghost = IMG_NORM_PIXEL(ghost, uv).rgb;
		vec3 src = IMG_NORM_PIXEL(inputImage, uv).rgb;
		gl_FragColor = vec4(clamp(src + ghost * amount, 0.0, 1.0), 1.0);
	} else {
		gl_FragColor = IMG_NORM_PIXEL(scene, uv);
	}
}
