/*{
	"DESCRIPTION": "Restrained broadcast-VHS grade: blocky sampling, per-line wobble, timed glitch bursts, a wandering blue tracking band, chroma split, grain, scanlines and vignette. Port of 'VHS CRT Broadcast' from godotshaders.com; the mip-LOD blur is approximated with a small box blur.",
	"CREDIT": "banwarfarms — godotshaders.com (port)",
	"LICENSE": "CC0",
	"SOURCE": "https://godotshaders.com/shader/vhs-crt-broadcast/",
	"CATEGORIES": ["Retro", "Glitch", "Godot"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "pixel_size", "TYPE": "float", "MIN": 1.0, "MAX": 4.0, "DEFAULT": 2.0 },
		{ "NAME": "lod_blur", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.7 },
		{ "NAME": "chroma_offset_px", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.8 },
		{ "NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.78 },
		{ "NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 1.5, "DEFAULT": 0.9 },
		{ "NAME": "shadow_lift", "TYPE": "float", "MIN": 0.0, "MAX": 0.25, "DEFAULT": 0.06 },
		{ "NAME": "scanline_strength", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.04 },
		{ "NAME": "vignette_strength", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.1 },
		{ "NAME": "noise_strength", "TYPE": "float", "MIN": 0.0, "MAX": 0.12, "DEFAULT": 0.025 },
		{ "NAME": "noise_speed", "TYPE": "float", "MIN": 0.0, "MAX": 60.0, "DEFAULT": 18.0 },
		{ "NAME": "base_jitter_px", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.08 },
		{ "NAME": "base_jitter_speed", "TYPE": "float", "MIN": 0.0, "MAX": 40.0, "DEFAULT": 12.0 },
		{ "NAME": "glitchiness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.18 },
		{ "NAME": "glitch_rate", "TYPE": "float", "MIN": 0.0, "MAX": 20.0, "DEFAULT": 6.0 },
		{ "NAME": "glitch_shift_px", "TYPE": "float", "MIN": 0.0, "MAX": 8.0, "DEFAULT": 1.8 },
		{ "NAME": "glitch_window_min", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.03 },
		{ "NAME": "glitch_window_max", "TYPE": "float", "MIN": 0.0, "MAX": 0.35, "DEFAULT": 0.1 },
		{ "NAME": "blue_band_start_y", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45 },
		{ "NAME": "blue_band_speed", "TYPE": "float", "MIN": -1.5, "MAX": 1.5, "DEFAULT": 0.06 },
		{ "NAME": "blue_band_width", "TYPE": "float", "MIN": 0.002, "MAX": 0.2, "DEFAULT": 0.035 },
		{ "NAME": "blue_band_strength", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1 },
		{ "NAME": "blue_band_glitch", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25 },
		{ "NAME": "blue_band_distort_px", "TYPE": "float", "MIN": 0.0, "MAX": 6.0, "DEFAULT": 1.2 }
	]
}*/

float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453123); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

vec3 sat_adjust(vec3 c, float s) {
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	return mix(vec3(l), c, s);
}

// Godot coordinates are y-down; flip only when touching the texture.
vec3 tap(vec2 guv) {
	return IMG_NORM_PIXEL(inputImage, clamp(vec2(guv.x, 1.0 - guv.y), 0.0, 1.0)).rgb;
}
// textureLod stand-in: 5-tap box whose radius grows with the LOD.
vec3 sample_screen(vec2 uv, float lod) {
	if (lod <= 0.0) return tap(uv);
	vec2 r = (exp2(lod) - 1.0) / RENDERSIZE;
	vec3 c = tap(uv) * 2.0;
	c += tap(uv + vec2(r.x, 0.0)) + tap(uv - vec2(r.x, 0.0));
	c += tap(uv + vec2(0.0, r.y)) + tap(uv - vec2(0.0, r.y));
	return c / 6.0;
}

void main() {
	vec2 px = 1.0 / RENDERSIZE;
	vec2 SCREEN_UV = vec2(isf_FragNormCoord.x, 1.0 - isf_FragNormCoord.y);
	vec2 FRAGCOORD = vec2(gl_FragCoord.x, RENDERSIZE.y - gl_FragCoord.y);
	vec2 uv = SCREEN_UV;
	float t = TIME;
	float line_id = floor(FRAGCOORD.y);

	// mild blocky grouping to kill digital sharpness
	vec2 block = px * pixel_size;
	uv = floor(uv / block) * block;

	// subtle per-line wobble that updates over time
	float line_wobble = hash21(vec2(line_id, floor(t * base_jitter_speed)));
	uv.x += (line_wobble - 0.5) * base_jitter_px * px.x;

	// occasional glitch burst window
	float burst_id = floor(t * glitch_rate);
	float burst_rand = hash11(burst_id + 3.17);
	float burst_on = step(1.0 - glitchiness, burst_rand);
	float glitch_center = hash11(burst_id + 8.41);
	float glitch_half_height = mix(glitch_window_min, glitch_window_max, hash11(burst_id + 11.72));
	float glitch_mask = burst_on * (1.0 - smoothstep(0.0, glitch_half_height, abs(SCREEN_UV.y - glitch_center)));
	float glitch_line = hash21(vec2(line_id, burst_id + 31.3));
	uv.x += (glitch_line - 0.5) * glitch_shift_px * px.x * glitch_mask;

	// moving blue band with occasional jumpiness
	float band_tick = floor(t * 10.0);
	float band_jump = (hash11(band_tick + 55.2) - 0.5) * blue_band_glitch * 0.25;
	float band_center = fract(blue_band_start_y + t * blue_band_speed + band_jump);
	float band_dist = abs(SCREEN_UV.y - band_center);
	band_dist = min(band_dist, 1.0 - band_dist);
	float band_mask = exp(-(band_dist * band_dist) / max(blue_band_width * blue_band_width, 0.000001));
	float band_line = hash21(vec2(line_id, floor(t * 22.0) + 77.0));
	uv.x += (band_line - 0.5) * blue_band_distort_px * px.x * band_mask;

	// chroma split
	vec2 chroma_off = vec2(chroma_offset_px * px.x, 0.0);
	float r = sample_screen(uv + chroma_off, lod_blur).r;
	float g = sample_screen(uv, lod_blur).g;
	float b = sample_screen(uv - chroma_off, lod_blur).b;
	vec3 col = vec3(r, g, b);

	// overall VHS grade
	col = sat_adjust(col, saturation);
	col = (col - vec3(0.5)) * contrast + vec3(0.5);
	col += shadow_lift;

	// blue tracking tint
	col += vec3(0.02, 0.07, 0.18) * band_mask * blue_band_strength;

	// animated grain + line snow
	float grain = hash21(floor(FRAGCOORD.xy * 0.75) + vec2(floor(t * noise_speed), floor(t * noise_speed * 0.73)));
	float line_snow = hash21(vec2(line_id, floor(t * noise_speed * 0.5) + 100.0));
	col += ((grain - 0.5) * 0.7 + (line_snow - 0.5) * 0.3) * noise_strength;

	// scanlines
	float scan = sin((FRAGCOORD.y + t * 8.0) * 1.1) * 0.5 + 0.5;
	col *= 1.0 - scan * scanline_strength;

	// vignette
	vec2 centered = SCREEN_UV * 2.0 - 1.0;
	float vig = dot(centered, centered);
	col *= 1.0 - vig * vignette_strength;

	gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);
}
