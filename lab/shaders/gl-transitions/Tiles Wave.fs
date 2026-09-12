/*{
	"DESCRIPTION": "Tiles fold over in a diagonal wave from bottom-left to top-right, each tile squashing then revealing the next image. Port of gl-transitions TilesWave.",
	"CREDIT": "numb3r23 — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/TilesWave.glsl",
	"CATEGORIES": ["Transition", "Tile Effect"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "tileCount", "LABEL": "Tiles", "TYPE": "point2D", "MIN": [1, 1], "MAX": [32, 32], "DEFAULT": [8, 8] },
		{ "NAME": "flipX", "LABEL": "Flip X", "TYPE": "bool", "DEFAULT": true },
		{ "NAME": "flipY", "LABEL": "Flip Y", "TYPE": "bool", "DEFAULT": false }
	]
}*/

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

void main() {
	vec2 uv = isf_FragNormCoord;
	vec2 tc = vec2(int(tileCount.x), int(tileCount.y));
	vec2 tileSize = 1.0 / tc;
	vec2 posInTile = fract(uv * tc);
	vec2 tileNum = floor(uv * tc);
	float countTiles = tc.x * tc.y;

	float offset = (tileNum.y + tileNum.x * tc.y) / countTiles;
	float timeOffset = clamp((progress - offset) * countTiles, 0.0, 0.5);
	float sinTime = 1.0 - abs(cos(fract(timeOffset) * 3.1415926));

	vec2 texC = posInTile;

	if (sinTime <= 0.5) {
		if (flipX) {
			if (texC.x < sinTime || texC.x > 1.0 - sinTime) { gl_FragColor = getFromColor(uv); return; }
			texC.x = texC.x < 0.5
				? (texC.x - sinTime) * 0.5 / (0.5 - sinTime)
				: (texC.x - 0.5) * 0.5 / (0.5 - sinTime) + 0.5;
		}
		if (flipY) {
			if (texC.y < sinTime || texC.y > 1.0 - sinTime) { gl_FragColor = getFromColor(uv); return; }
			texC.y = texC.y < 0.5
				? (texC.y - sinTime) * 0.5 / (0.5 - sinTime)
				: (texC.y - 0.5) * 0.5 / (0.5 - sinTime) + 0.5;
		}
		gl_FragColor = getFromColor(tileNum * tileSize + texC * tileSize);
	} else {
		if (flipX) {
			if (texC.x > sinTime || texC.x < 1.0 - sinTime) { gl_FragColor = getToColor(uv); return; }
			texC.x = texC.x < 0.5
				? (texC.x - sinTime) * 0.5 / (0.5 - sinTime)
				: (texC.x - 0.5) * 0.5 / (0.5 - sinTime) + 0.5;
			texC.x = 1.0 - texC.x;
		}
		if (flipY) {
			if (texC.y > sinTime || texC.y < 1.0 - sinTime) { gl_FragColor = getToColor(uv); return; }
			texC.y = texC.y < 0.5
				? (texC.y - sinTime) * 0.5 / (0.5 - sinTime)
				: (texC.y - 0.5) * 0.5 / (0.5 - sinTime) + 0.5;
			texC.y = 1.0 - texC.y;
		}
		gl_FragColor = getToColor(tileNum * tileSize + texC * tileSize);
	}
}
