/*{
	"DESCRIPTION": "Datamosh-flavored broadcast damage: torn scan bands, vertical slits, chroma split, time-slice residue and white hairlines carry one image into the other. Port of gl-transitions StripDatamoshGlitch.",
	"CREDIT": "bread — gl-transitions (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/StripDatamoshGlitch.glsl",
	"CATEGORIES": ["Transition", "Glitch"],
	"INPUTS": [
		{ "NAME": "startImage", "TYPE": "image" },
		{ "NAME": "endImage", "TYPE": "image" },
		{ "NAME": "progress", "LABEL": "Progress", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
		{ "NAME": "strength", "LABEL": "Strength", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 1 },
		{ "NAME": "horizontalBars", "LABEL": "H bars", "TYPE": "float", "MIN": 4, "MAX": 120, "DEFAULT": 42 },
		{ "NAME": "verticalSlits", "LABEL": "V slits", "TYPE": "float", "MIN": 2, "MAX": 60, "DEFAULT": 18 },
		{ "NAME": "tear", "LABEL": "Tear", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.18 },
		{ "NAME": "chroma", "LABEL": "Chroma", "TYPE": "float", "MIN": 0, "MAX": 0.1, "DEFAULT": 0.032 },
		{ "NAME": "residue", "LABEL": "Residue", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.62 },
		{ "NAME": "noiseAmount", "LABEL": "Noise", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.16 },
		{ "NAME": "scanAmount", "LABEL": "Scan", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.13 },
		{ "NAME": "flashAmount", "LABEL": "Flash", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.2 }
	]
}*/

const float PI = 3.141592653589793;

vec4 getFromColor(vec2 uv) { return IMG_NORM_PIXEL(startImage, uv); }
vec4 getToColor(vec2 uv) { return IMG_NORM_PIXEL(endImage, uv); }

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float sat(float v) { return clamp(v, 0.0, 1.0); }

float burst() {
	return pow(max(0.0, sin(progress * PI)), 0.42) * strength;
}
vec2 safeUv(vec2 uv) {
	return clamp(uv, vec2(0.0), vec2(1.0));
}
float stripeY(vec2 uv, float density, float seed, float minWidth, float maxWidth) {
	float y = uv.y * density + seed * 0.137;
	float id = floor(y);
	float f = fract(y);
	float c = hash2(vec2(id, seed));
	float w = mix(minWidth, maxWidth, hash2(vec2(id + 9.17, seed + 2.31)));
	return 1.0 - smoothstep(w, w + 0.018, abs(f - c));
}
float stripeX(vec2 uv, float density, float seed, float minWidth, float maxWidth) {
	float x = uv.x * density + seed * 0.091;
	float id = floor(x);
	float f = fract(x);
	float c = hash2(vec2(id, seed + 41.0));
	float w = mix(minWidth, maxWidth, hash2(vec2(id + 4.7, seed + 8.9)));
	return 1.0 - smoothstep(w, w + 0.012, abs(f - c));
}
float brokenGate(vec2 uv, float row, float rnd, float frame) {
	float segs = mix(1.0, 9.0, hash2(vec2(row, frame + 44.0)));
	float seg = floor(uv.x * segs);
	return step(0.16, hash2(vec2(seg, row + frame * 3.0 + rnd)));
}
float horizontalMask(vec2 uv, float frame) {
	float r1 = floor((uv.y + hash(frame) * 0.031) * horizontalBars * 0.38);
	float r2 = floor((uv.y + hash(frame + 2.0) * 0.013) * horizontalBars);
	float r3 = floor((uv.y + hash(frame + 7.0) * 0.006) * horizontalBars * 3.4);

	float thick = stripeY(uv, horizontalBars * 0.38, frame + 1.0, 0.035, 0.22);
	float mid = stripeY(uv, horizontalBars, frame + 4.0, 0.014, 0.11);
	float hair = stripeY(uv, horizontalBars * 3.4, frame + 9.0, 0.004, 0.035);

	thick *= step(0.42, hash2(vec2(r1, frame + 10.0)));
	mid *= step(0.48, hash2(vec2(r2, frame + 20.0)));
	hair *= step(0.62, hash2(vec2(r3, frame + 30.0)));

	thick *= brokenGate(uv, r1, hash2(vec2(r1, frame)), frame);
	mid *= brokenGate(uv, r2, hash2(vec2(r2, frame)), frame + 3.0);

	return sat(max(thick, max(mid, hair)));
}
float verticalMask(vec2 uv, float frame) {
	float col = floor((uv.x + hash(frame + 12.0) * 0.017) * verticalSlits);
	float slit = stripeX(uv, verticalSlits, frame + 13.0, 0.01, 0.075);
	slit *= step(0.66, hash2(vec2(col, frame + 19.0)));
	return sat(slit);
}
vec4 chromaFrom(vec2 uv, vec2 s) {
	uv = safeUv(uv);
	return vec4(getFromColor(safeUv(uv + s)).r, getFromColor(uv).g, getFromColor(safeUv(uv - s)).b, 1.0);
}
vec4 chromaTo(vec2 uv, vec2 s) {
	uv = safeUv(uv);
	return vec4(getToColor(safeUv(uv - s)).r, getToColor(uv).g, getToColor(safeUv(uv + s)).b, 1.0);
}
vec2 distortUv(vec2 uv, float dir, float b, float h, float v, float frame) {
	float row = floor(uv.y * horizontalBars);
	float col = floor(uv.x * verticalSlits);
	float rowRnd = hash2(vec2(row, frame));
	float colRnd = hash2(vec2(col, frame + 27.0));
	float xTear = (rowRnd - 0.5) * 2.0 * tear * b * h;
	xTear += sin(uv.y * 120.0 + progress * 95.0) * 0.006 * b;
	float yDrag = (colRnd - 0.5) * 0.13 * b * v;
	float micro = (hash2(vec2(row, col + frame)) - 0.5) * 0.018 * b * max(h, v);
	return uv + vec2(xTear * dir + micro, yDrag);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (progress <= 0.0) { gl_FragColor = getFromColor(uv); return; }
	if (progress >= 1.0) { gl_FragColor = getToColor(uv); return; }

	float ratio = RENDERSIZE.x / RENDERSIZE.y;
	float b = burst();
	float frame = floor(progress * 30.0);

	float h = horizontalMask(uv, frame);
	float v = verticalMask(uv, frame);
	float glitch = sat(max(h, v * 0.75));

	float row = floor(uv.y * horizontalBars);
	float rowRnd = hash2(vec2(row, frame + 5.0));

	float bandDelay = (rowRnd - 0.5) * 0.30 * h;
	float reveal = smoothstep(0.18, 0.84, progress + bandDelay);

	vec2 split = vec2(chroma * b * (1.0 + 1.7 * glitch), chroma * 0.22 * b * v);
	vec2 fromUv = distortUv(uv, 1.0, b, h, v, frame);
	vec2 toUv = distortUv(uv, -1.0, b, h, v, frame);

	vec4 color = mix(chromaFrom(fromUv, split), chromaTo(toUv, split), reveal);

	vec2 smearUv = uv;
	smearUv.x += (rowRnd - 0.5) * 0.46 * b * h;
	smearUv.y += (hash2(vec2(row, frame + 31.0)) - 0.5) * 0.045 * b * h;

	float sliceReveal = smoothstep(0.28, 0.78, progress + (rowRnd - 0.5) * 0.22);
	vec4 sliceColor = mix(
		chromaFrom(smearUv, split * 1.65),
		chromaTo(smearUv - vec2((rowRnd - 0.5) * 0.18 * b, 0.0), split * 1.65),
		sliceReveal
	);
	color = mix(color, sliceColor, h * b * residue);

	float hairLine = stripeY(uv, 190.0, frame + 55.0, 0.002, 0.012);
	hairLine *= step(0.70, hash2(vec2(floor(uv.y * 190.0), frame + 56.0)));
	color.rgb += vec3(0.72, 0.90, 1.0) * hairLine * b * 0.28;

	float scan = 0.5 + 0.5 * sin(uv.y * 980.0 + progress * 130.0);
	color.rgb *= 1.0 - scanAmount * b * scan;

	vec2 nCell = floor(uv * vec2(360.0 * ratio, 210.0));
	float n = hash2(nCell + vec2(frame * 7.0, frame * 13.0));
	color.rgb += (n - 0.5) * noiseAmount * b * (0.55 + glitch);

	float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
	color.rgb = mix(color.rgb, vec3(luma), 0.18 * b * glitch);

	float strobe = step(0.78, hash2(vec2(frame, 3.14))) * pow(b, 1.65);
	color.rgb += vec3(strobe * flashAmount);

	gl_FragColor = vec4(clamp(color.rgb, vec3(0.0), vec3(1.0)), 1.0);
}
