/*{
	"DESCRIPTION": "Hexagonal bokeh blur: three rhombus-shaped blurs combined into a hexagon, done on a power curve so highlights bloom into bright aperture shapes. Port of glfx.js lensBlur().",
	"CREDIT": "Evan Wallace — glfx.js (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/evanw/glfx.js/blob/master/src/filters/blur/lensblur.js",
	"CATEGORIES": ["Blur", "Lens"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "radius", "LABEL": "Radius", "TYPE": "float", "MIN": 0, "MAX": 0.1, "DEFAULT": 0.03 },
		{ "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "MIN": -1, "MAX": 1, "DEFAULT": 0.6 },
		{ "NAME": "angle", "LABEL": "Angle (°)", "TYPE": "float", "MIN": 0, "MAX": 180, "DEFAULT": 0 }
	],
	"PASSES": [
		{ "TARGET": "pre", "FLOAT": true },
		{ "TARGET": "rhombA", "FLOAT": true },
		{ "TARGET": "rhombB", "FLOAT": true },
		{ "TARGET": "rhombC", "FLOAT": true },
		{ }
	]
}*/

float random(vec3 scale, float seed) {
	return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
}

vec4 rhombus(sampler2D tex, vec2 delta) {
	float offset = random(vec3(delta, 151.7182), 0.0);
	vec4 color = vec4(0.0);
	for (float t = 0.0; t <= 30.0; t++)
		color += texture(tex, isf_FragNormCoord + delta * ((t + offset) / 30.0));
	return color / 31.0;
}

vec2 dir(int i) {
	float a = radians(angle) + float(i) * 6.28318530718 / 3.0;
	// glfx measures radius in pixels; here it is a fraction of the frame height.
	float r = radius * RENDERSIZE.y;
	return vec2(r * sin(a) / RENDERSIZE.x, r * cos(a) / RENDERSIZE.y);
}

void main() {
	float power = pow(10.0, clamp(brightness, -1.0, 1.0));
	if (PASSINDEX == 0) gl_FragColor = pow(IMG_THIS_NORM_PIXEL(inputImage), vec4(power));
	else if (PASSINDEX == 1) gl_FragColor = rhombus(pre, dir(0));
	else if (PASSINDEX == 2) gl_FragColor = (rhombus(rhombA, dir(1)) + rhombus(rhombA, dir(2))) * 0.5;
	else if (PASSINDEX == 3) gl_FragColor = rhombus(pre, dir(1));
	else {
		vec4 color = (rhombus(rhombC, dir(2)) + 2.0 * IMG_THIS_NORM_PIXEL(rhombB)) / 3.0;
		gl_FragColor = vec4(pow(color, vec4(1.0 / power)).rgb, 1.0);
	}
}
