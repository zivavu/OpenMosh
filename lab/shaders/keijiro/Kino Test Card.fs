/*{
	"DESCRIPTION": "Broadcast test card (grid, crosshair, grey and colour bars, circles) blended over the picture. Port of Kino's TestCard; blended in sRGB as the original does.",
	"CREDIT": "Keijiro Takahashi — Kino TestCard (port)",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/Kino",
	"CATEGORIES": ["Overlay", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "opacity", "LABEL": "Opacity", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.6 }
	]
}*/

vec3 HsvToRgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 TestPattern(vec2 uv) {
	float scale = 27.0 / RENDERSIZE.y;
	vec2 p0 = (uv - 0.5) * RENDERSIZE;
	vec2 p1 = p0 * scale;
	vec2 p2 = p1 / 2.0 - 0.5;

	float aspect = RENDERSIZE.x / RENDERSIZE.y;
	vec2 area = vec2(floor(6.5 * aspect) * 2.0 + 1.0, 13.0);

	vec2 ch = abs(p0);
	vec2 grid = (1.0 - abs(fract(p2) - 0.5) * 2.0) / scale;
	float c1 = min(min(ch.x, ch.y), min(grid.x, grid.y)) < 1.0 ? 1.0 : 0.5;

	vec2 checker = fract(floor(p2) / 2.0) * 2.0;
	if (any(greaterThan(abs(p1), area))) c1 = abs(checker.x - checker.y);

	float corner = sqrt(8.0) - length(abs(p1) - area + 4.0);
	float circle = 12.0 - length(p1);
	float mask = clamp(circle / scale, 0.0, 1.0);

	float bar1 = clamp(p1.y < 5.0 ? floor(p1.x / 4.0 + 3.0) / 5.0 : p1.x / 16.0 + 0.5, 0.0, 1.0);
	if (abs(5.0 - p1.y) < 4.0 * mask) c1 = bar1;

	vec3 bar2 = HsvToRgb(vec3((p1.y > -5.0 ? floor(p1.x / 4.0) / 6.0 : p1.x / 16.0) + 0.5, 1.0, 1.0));
	vec3 rgb = abs(-5.0 - p1.y) < 4.0 * mask ? bar2 : vec3(clamp(c1, 0.0, 1.0));

	rgb = mix(rgb, vec3(1.0), clamp(1.5 - abs(max(circle, corner)) / scale, 0.0, 1.0));
	return rgb;
}

void main() {
	vec4 c = IMG_THIS_NORM_PIXEL(inputImage);
	// Unity's texcoord runs bottom-up like ours, so the pattern needs no flip.
	gl_FragColor = vec4(mix(c.rgb, TestPattern(isf_FragNormCoord), opacity), 1.0);
}
