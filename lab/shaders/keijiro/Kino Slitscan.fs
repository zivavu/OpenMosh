/*{
	"DESCRIPTION": "Slit-scan: each band of the frame shows a different moment from the last 64 frames, so motion stretches and bends. Port of KinoSlitscan; the 128-frame YCgCo history became a 64-frame quarter-resolution atlas, and horizontal, radial and luminance (time displacement) modes were added.",
	"CREDIT": "Keijiro Takahashi — KinoSlitscan (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/keijiro/KinoSlitscan",
	"CATEGORIES": ["Time", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "mode", "LABEL": "Direction", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["Vertical (original)", "Horizontal", "Radial", "Luminance"], "DEFAULT": 0 },
		{ "NAME": "depth", "LABEL": "Depth (frames)", "TYPE": "float", "MIN": 1, "MAX": 63, "DEFAULT": 40 },
		{ "NAME": "slices", "LABEL": "Slices", "TYPE": "float", "MIN": 4, "MAX": 256, "DEFAULT": 128 },
		{ "NAME": "flip", "LABEL": "Newest at far end", "TYPE": "bool", "DEFAULT": false }
	],
	"PASSES": [
		{ "TARGET": "history", "PERSISTENT": true, "WIDTH": "$WIDTH * 2.0", "HEIGHT": "$HEIGHT * 2.0" },
		{ }
	]
}*/

const float GRID = 8.0;
const int SLOTS = 64;

vec2 slotOrigin(int slot) {
	return vec2(float(slot % 8), float(slot / 8)) / GRID;
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (PASSINDEX == 0) {
		vec2 tile = floor(uv * GRID);
		int slot = FRAMEINDEX % SLOTS;
		if (int(tile.y) * 8 + int(tile.x) == slot)
			gl_FragColor = IMG_NORM_PIXEL(inputImage, fract(uv * GRID));
		else
			gl_FragColor = IMG_NORM_PIXEL(history, uv);
		return;
	}

	float pos;
	if (mode == 1) pos = uv.x;
	else if (mode == 2) pos = clamp(length((uv - 0.5) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0)) * 1.6, 0.0, 1.0);
	else if (mode == 3) pos = dot(IMG_NORM_PIXEL(inputImage, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
	else pos = uv.y;
	if (flip) pos = 1.0 - pos;
	pos = floor(pos * slices) / slices;

	int delay = min(int(pos * depth + 0.5), FRAMEINDEX);
	int slot = ((FRAMEINDEX - delay) % SLOTS + SLOTS) % SLOTS;
	// Half a texel in from the tile edge so linear filtering can't bleed neighbours.
	vec2 texel = 1.0 / IMG_SIZE(history);
	vec2 local = clamp(uv / GRID, texel * 0.5, 1.0 / GRID - texel * 0.5);
	gl_FragColor = vec4(IMG_NORM_PIXEL(history, slotOrigin(slot) + local).rgb, 1.0);
}
