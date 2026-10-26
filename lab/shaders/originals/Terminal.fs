/*{
	"DESCRIPTION": "Text-mode rendering: the frame is redrawn as 5×7 bitmap characters picked by brightness from a 16-step density ramp, in green or amber phosphor, the source colours, or falling code rain. Characters glow faintly and flicker as the picture moves.",
	"CREDIT": "OpenMosh lab original",
	"LICENSE": "MIT",
	"CATEGORIES": ["Stylize", "Text", "Retro"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "rows", "LABEL": "Rows", "TYPE": "float", "MIN": 12, "MAX": 160, "DEFAULT": 36 },
		{ "NAME": "palette", "LABEL": "Colour", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["Green phosphor", "Amber", "Source colour", "Code rain"], "DEFAULT": 2 },
		{ "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "MIN": 0.5, "MAX": 3, "DEFAULT": 1.4 },
		{ "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.35 },
		{ "NAME": "background", "LABEL": "Background", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.06 },
		{ "NAME": "rainSpeed", "LABEL": "Rain speed", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 1 }
	]
}*/

// Ramp by ink coverage: ' ' '.' '-' ':' '+' 'x' '=' 'o' '%' '&' '*' '8' 'M' 'W' '#' '@'
// Bit (y * 5 + x) is set when the pixel at column x, row y (from the top) is lit.
const ivec2 GLYPHS[16] = ivec2[16](ivec2(0, 0), ivec2(0, 6336), ivec2(1015808, 0), ivec2(6336, 198), ivec2(1020032, 132), ivec2(345088, 17732), ivec2(31744, 31), ivec2(571392, 14897), ivec2(70003, 793), ivec2(70950, 22837), ivec2(1030816, 686), ivec2(476718, 14897), ivec2(710513, 17969), ivec2(706097, 18293), ivec2(359754, 10591), ivec2(718382, 30781));

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float glyphPixel(int g, ivec2 px) {
	if (px.x < 0 || px.x > 4 || px.y < 0 || px.y > 6) return 0.0;
	int bit = px.y * 5 + px.x;
	ivec2 bits = GLYPHS[g];
	int word = bit < 20 ? bits.x : bits.y;
	int b = bit < 20 ? bit : bit - 20;
	return float((word >> b) & 1);
}

// Soft glyph: the lit dot under p plus a little light from its neighbours.
float glyph(int g, vec2 p) {
	ivec2 px = ivec2(floor(p));
	vec2 f = fract(p) - 0.5;
	float core = glyphPixel(g, px) * (1.0 - smoothstep(0.42, 0.62, max(abs(f.x), abs(f.y))));
	float halo = 0.0;
	for (int y = -1; y <= 1; y++)
		for (int x = -1; x <= 1; x++)
			halo += glyphPixel(g, px + ivec2(x, y)) * exp(-dot(f - vec2(x, y), f - vec2(x, y)) * 1.8);
	return core + halo * glow * 0.25;
}

void main() {
	float cellH = RENDERSIZE.y / rows;
	vec2 cellSize = vec2(cellH * 0.75, cellH);
	vec2 top = vec2(gl_FragCoord.x, RENDERSIZE.y - gl_FragCoord.y);
	vec2 cell = floor(top / cellSize);
	vec2 local = fract(top / cellSize) * vec2(6.0, 8.0) - vec2(0.5, 0.5);

	vec2 at = (cell + 0.5) * cellSize;
	vec3 src = IMG_NORM_PIXEL(inputImage, vec2(at.x, RENDERSIZE.y - at.y) / RENDERSIZE).rgb;
	float l = clamp((dot(src, vec3(0.299, 0.587, 0.114)) - 0.5) * contrast + 0.5, 0.0, 1.0);

	int g = int(floor(l * 15.99));
	vec3 ink;
	if (palette == 0) ink = vec3(0.35, 1.0, 0.45);
	else if (palette == 1) ink = vec3(1.0, 0.7, 0.2);
	else if (palette == 2) ink = src / max(max(src.r, max(src.g, src.b)), 0.25);
	else {
		// Each column has a falling head; characters behind it fade and keep changing.
		float speed = (0.6 + hash12(vec2(cell.x, 1.0))) * rainSpeed * 12.0;
		float span = rows * (1.0 + hash12(vec2(cell.x, 2.0)));
		float head = mod(TIME * speed + hash12(vec2(cell.x, 3.0)) * span, span);
		float behind = head - cell.y;
		float trail = behind >= 0.0 ? exp(-behind / (rows * 0.25)) : 0.0;
		float flick = floor(TIME * 10.0 + hash12(cell) * 10.0);
		int rg = 4 + int(hash12(cell + flick) * 12.0);
		g = int(mix(float(rg), float(g), 0.5));
		bool isHead = behind >= 0.0 && behind < 1.0;
		ink = isHead ? vec3(0.85, 1.0, 0.9) : vec3(0.2, 1.0, 0.35) * trail * (0.35 + 0.65 * l);
		if (trail < 0.02 && !isHead) g = 0;
	}
	float v = glyph(g, local);
	vec3 bg = palette == 2 ? src * background : ink * background * 0.3;
	gl_FragColor = vec4(bg + ink * v, 1.0);
}
