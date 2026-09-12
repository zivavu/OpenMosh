/*{
	"DESCRIPTION": "Anamorphic lens-flare streaks: bright pixels are pre-filtered at half height, blurred down a horizontal-only mip pyramid and blended back up, then tinted and added. Port of KinoStreak with a fixed 6-level pyramid.",
	"CREDIT": "Keijiro Takahashi — KinoStreak (port)",
	"LICENSE": "Unlicense",
	"SOURCE": "https://github.com/keijiro/KinoStreak",
	"CATEGORIES": ["Stylize", "Blur", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "threshold", "TYPE": "float", "MIN": 0.0, "MAX": 5.0, "DEFAULT": 0.6 },
		{ "NAME": "stretch", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.75 },
		{ "NAME": "intensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3 },
		{ "NAME": "tint", "TYPE": "color", "DEFAULT": [0.55, 0.55, 1.0, 1.0] }
	],
	"PASSES": [
		{ "TARGET": "pre", "WIDTH": "$WIDTH", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "d1", "WIDTH": "$WIDTH/2.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "d2", "WIDTH": "$WIDTH/4.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "d3", "WIDTH": "$WIDTH/8.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "d4", "WIDTH": "$WIDTH/16.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "d5", "WIDTH": "$WIDTH/32.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "d6", "WIDTH": "$WIDTH/64.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "u5", "WIDTH": "$WIDTH/32.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "u4", "WIDTH": "$WIDTH/16.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "u3", "WIDTH": "$WIDTH/8.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "u2", "WIDTH": "$WIDTH/4.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{ "TARGET": "u1", "WIDTH": "$WIDTH/2.0", "HEIGHT": "$HEIGHT/2.0", "FLOAT": true },
		{}
	]
}*/

// Six-tap horizontal box, 1.25 px spacing at the *source* resolution.
vec3 down(sampler2D src, vec2 srcSize, vec2 uv) {
	float dx = 1.25 / srcSize.x;
	vec3 c = texture(src, vec2(uv.x - dx * 5.0, uv.y)).rgb
	       + texture(src, vec2(uv.x - dx * 3.0, uv.y)).rgb
	       + texture(src, vec2(uv.x - dx * 1.0, uv.y)).rgb
	       + texture(src, vec2(uv.x + dx * 1.0, uv.y)).rgb
	       + texture(src, vec2(uv.x + dx * 3.0, uv.y)).rgb
	       + texture(src, vec2(uv.x + dx * 5.0, uv.y)).rgb;
	return c / 6.0;
}
vec3 up(sampler2D low, sampler2D high, vec2 uv) {
	return mix(texture(high, uv).rgb, texture(low, uv).rgb, stretch);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	if (PASSINDEX == 0) {
		float dy = (1.0 / IMG_SIZE(inputImage).y) * 1.5 / 2.0;
		vec3 c0 = IMG_NORM_PIXEL(inputImage, vec2(uv.x, uv.y - dy)).rgb;
		vec3 c1 = IMG_NORM_PIXEL(inputImage, vec2(uv.x, uv.y + dy)).rgb;
		vec3 c = (c0 + c1) / 2.0;
		float br = max(c.r, max(c.g, c.b));
		c *= max(0.0, br - threshold) / max(br, 1e-5);
		gl_FragColor = vec4(c, 1.0);
	}
	else if (PASSINDEX == 1) gl_FragColor = vec4(down(pre, IMG_SIZE(pre), uv), 1.0);
	else if (PASSINDEX == 2) gl_FragColor = vec4(down(d1, IMG_SIZE(d1), uv), 1.0);
	else if (PASSINDEX == 3) gl_FragColor = vec4(down(d2, IMG_SIZE(d2), uv), 1.0);
	else if (PASSINDEX == 4) gl_FragColor = vec4(down(d3, IMG_SIZE(d3), uv), 1.0);
	else if (PASSINDEX == 5) gl_FragColor = vec4(down(d4, IMG_SIZE(d4), uv), 1.0);
	else if (PASSINDEX == 6) gl_FragColor = vec4(down(d5, IMG_SIZE(d5), uv), 1.0);
	else if (PASSINDEX == 7) gl_FragColor = vec4(up(d6, d5, uv), 1.0);
	else if (PASSINDEX == 8) gl_FragColor = vec4(up(u5, d4, uv), 1.0);
	else if (PASSINDEX == 9) gl_FragColor = vec4(up(u4, d3, uv), 1.0);
	else if (PASSINDEX == 10) gl_FragColor = vec4(up(u3, d2, uv), 1.0);
	else if (PASSINDEX == 11) gl_FragColor = vec4(up(u2, d1, uv), 1.0);
	else {
		vec3 streak = IMG_NORM_PIXEL(u1, uv).rgb * tint.rgb * intensity * 5.0;
		gl_FragColor = vec4(streak + IMG_NORM_PIXEL(inputImage, uv).rgb, 1.0);
	}
}
