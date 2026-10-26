/*{
	"DESCRIPTION": "Comic recolour: luminance maps onto a four-key gradient (stepped or smooth, optionally dithered) and Roberts-cross colour edges are inked on top. Port of Kino's Recolor in colour-edge mode; the gradient editor became four colour keys.",
	"CREDIT": "Keijiro Takahashi — Kino Recolor (port)",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/Kino",
	"CATEGORIES": ["Color", "Stylize", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "key0", "LABEL": "Shadow", "TYPE": "color", "DEFAULT": [0.13, 0.1, 0.3, 1] },
		{ "NAME": "key1", "LABEL": "Low mid", "TYPE": "color", "DEFAULT": [0.85, 0.25, 0.4, 1] },
		{ "NAME": "key2", "LABEL": "High mid", "TYPE": "color", "DEFAULT": [1, 0.65, 0.3, 1] },
		{ "NAME": "key3", "LABEL": "Highlight", "TYPE": "color", "DEFAULT": [1, 0.97, 0.85, 1] },
		{ "NAME": "smoothGradient", "LABEL": "Smooth gradient", "TYPE": "bool", "DEFAULT": false },
		{ "NAME": "fillOpacity", "LABEL": "Fill opacity", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 1 },
		{ "NAME": "ditherStrength", "LABEL": "Dither", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.15 },
		{ "NAME": "edgeColor", "LABEL": "Edge colour", "TYPE": "color", "DEFAULT": [0.05, 0.03, 0.08, 1] },
		{ "NAME": "edgeThreshold", "LABEL": "Edge threshold", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.35 },
		{ "NAME": "edgeContrast", "LABEL": "Edge contrast", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.6 }
	]
}*/

float bayer4(ivec2 p) {
	float v = 0.0;
	for (int i = 0; i < 2; i++) {
		ivec2 q = (p >> i) & 1;
		v += float(((q.x ^ q.y) << 1) | q.y) * (i == 0 ? 4.0 : 1.0);
	}
	return (v + 0.5) / 16.0;
}

void main() {
	ivec2 ps = ivec2(gl_FragCoord.xy);
	vec2 uv = isf_FragNormCoord;
	vec2 px = 1.0 / RENDERSIZE;
	vec4 c0 = IMG_NORM_PIXEL(inputImage, uv);
	vec3 c1 = IMG_NORM_PIXEL(inputImage, uv + px).rgb;
	vec3 c2 = IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, 0.0)).rgb;
	vec3 c3 = IMG_NORM_PIXEL(inputImage, uv + vec2(0.0, px.y)).rgb;
	vec3 g1 = c1 - c0.rgb;
	vec3 g2 = c3 - c2;
	float g = sqrt(dot(g1, g1) + dot(g2, g2)) * 10.0;

	float dither = (bayer4(ps & 3) - 0.5) * ditherStrength;
	float lum = dot(c0.rgb, vec3(0.2126, 0.7152, 0.0722)) + dither;

	// Keys sit at 0, 1/3, 2/3, 1 like an evenly spaced Unity gradient.
	vec4 k0 = vec4(key0.rgb, 0.0), k1 = vec4(key1.rgb, 0.3333), k2 = vec4(key2.rgb, 0.6667), k3 = vec4(key3.rgb, 1.0);
	vec3 fill = k0.rgb;
	if (smoothGradient) {
		fill = mix(fill, k1.rgb, clamp((lum - k0.w) / (k1.w - k0.w), 0.0, 1.0));
		fill = mix(fill, k2.rgb, clamp((lum - k1.w) / (k2.w - k1.w), 0.0, 1.0));
		fill = mix(fill, k3.rgb, clamp((lum - k2.w) / (k3.w - k2.w), 0.0, 1.0));
	} else {
		// Four equal bands, like a fixed-mode Unity gradient.
		fill = lum > 0.25 ? k1.rgb : fill;
		fill = lum > 0.5 ? k2.rgb : fill;
		fill = lum > 0.75 ? k3.rgb : fill;
	}

	float t1 = edgeThreshold;
	float t2 = t1 + 1.01 - edgeContrast;
	float edge = smoothstep(t1, t2, g);
	vec3 cb = mix(c0.rgb, fill, fillOpacity);
	gl_FragColor = vec4(mix(cb, edgeColor.rgb, edge * edgeColor.a), 1.0);
}
