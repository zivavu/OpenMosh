/*{
	"DESCRIPTION": "Cheap single-pass fake of pixel sorting: a luminance mask melts columns downward with per-column turbulence, and what melts off the frame is replaced by a stretched row. Port of 'Pseudo Pixel Sorting V2' from godotshaders.com.",
	"CREDIT": "Ahopness — godotshaders.com (port)",
	"LICENSE": "CC0",
	"SOURCE": "https://godotshaders.com/shader/pseudo-pixel-sorting-v2/",
	"CATEGORIES": ["Glitch", "Godot"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "maskSoftness", "TYPE": "float", "MIN": -3.0, "MAX": 3.0, "DEFAULT": 1.4, "LABEL": "Mask softness (negative inverts)" },
		{ "NAME": "maskThreshold", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6 },
		{ "NAME": "sortAmount", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.6, "LABEL": "Sort" },
		{ "NAME": "melt", "TYPE": "bool", "DEFAULT": false, "LABEL": "Show the melt itself (not in original)" },
		{ "NAME": "showMask", "TYPE": "bool", "DEFAULT": false }
	]
}*/

// Godot's SCREEN_UV is y-down; keep the original math and flip on sampling.
vec4 screen(vec2 guv) {
	return IMG_NORM_PIXEL(inputImage, vec2(guv.x, 1.0 - guv.y));
}

void main() {
	vec2 uv = vec2(isf_FragNormCoord.x, 1.0 - isf_FragNormCoord.y);
	vec4 tex = screen(uv);

	// Masking
	float f = maskSoftness / 2.0;
	float a = maskThreshold - f;
	float b = maskThreshold + f;
	float average = (tex.x + tex.y + tex.z) / 3.0;
	float mask = smoothstep(a, b, average);
	if (showMask) {
		gl_FragColor = vec4(vec3(mask), 1.0);
		return;
	}

	// Pseudo pixel sorting
	float sort_threshold = 1.0 - clamp(sortAmount / 2.6, 0.0, 1.0);
	vec2 sort_uv = vec2(uv.x, sort_threshold);

	// Curved melting transition
	vec2 transition_uv = uv;
	float turbulance = fract(sin(dot(vec2(transition_uv.x), vec2(12.9, 78.2))) * 437.5);
	transition_uv.y += pow(sortAmount, 2.0 + (sortAmount * 2.0)) * mask * turbulance;

	// The original samples the untouched uv in the else branch, so only the
	// overflow shows; `melt` uses the displaced uv instead.
	if (transition_uv.y > 1.0) gl_FragColor = screen(sort_uv);
	else gl_FragColor = screen(melt ? transition_uv : uv);
}
