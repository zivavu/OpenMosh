/*{
	"DESCRIPTION": "Animated volumetric god rays built from periodic Perlin turbulence along a light direction. Port of the PixiJS GodrayFilter (parallel mode).",
	"CREDIT": "PixiJS filters — GodrayFilter (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/pixijs/filters/tree/main/src/godray",
	"CATEGORIES": ["Light", "Noise"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "angle", "LABEL": "Angle (°)", "TYPE": "float", "MIN": 0, "MAX": 360, "DEFAULT": 30 },
		{ "NAME": "gain", "LABEL": "Gain", "TYPE": "float", "MIN": 0.3, "MAX": 1, "DEFAULT": 0.6 },
		{ "NAME": "lacunarity", "LABEL": "Lacunarity", "TYPE": "float", "MIN": 1, "MAX": 4, "DEFAULT": 2 },
		{ "NAME": "alpha", "LABEL": "Alpha", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.4 },
		{ "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 1 },
		{ "NAME": "fade", "LABEL": "Vertical fade", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 1 }
	]
}*/

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float pnoise(vec3 P, vec3 rep) {
	vec3 Pi0 = mod(floor(P), rep);
	vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
	Pi0 = mod289(Pi0);
	Pi1 = mod289(Pi1);
	vec3 Pf0 = fract(P);
	vec3 Pf1 = Pf0 - vec3(1.0);
	vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
	vec4 iy = vec4(Pi0.yy, Pi1.yy);
	vec4 iz0 = Pi0.zzzz;
	vec4 iz1 = Pi1.zzzz;
	vec4 ixy = permute(permute(ix) + iy);
	vec4 ixy0 = permute(ixy + iz0);
	vec4 ixy1 = permute(ixy + iz1);
	vec4 gx0 = ixy0 * (1.0 / 7.0);
	vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
	gx0 = fract(gx0);
	vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
	vec4 sz0 = step(gz0, vec4(0.0));
	gx0 -= sz0 * (step(0.0, gx0) - 0.5);
	gy0 -= sz0 * (step(0.0, gy0) - 0.5);
	vec4 gx1 = ixy1 * (1.0 / 7.0);
	vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
	gx1 = fract(gx1);
	vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
	vec4 sz1 = step(gz1, vec4(0.0));
	gx1 -= sz1 * (step(0.0, gx1) - 0.5);
	gy1 -= sz1 * (step(0.0, gy1) - 0.5);
	vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
	vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
	vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
	vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
	vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
	vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
	vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
	vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
	vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
	g000 *= norm0.x;
	g010 *= norm0.y;
	g100 *= norm0.z;
	g110 *= norm0.w;
	vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
	g001 *= norm1.x;
	g011 *= norm1.y;
	g101 *= norm1.z;
	g111 *= norm1.w;
	float n000 = dot(g000, Pf0);
	float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
	float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
	float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
	float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
	float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
	float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
	float n111 = dot(g111, Pf1);
	vec3 fade_xyz = fade(Pf0);
	vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
	vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
	return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
}

float turb(vec3 P, vec3 rep, float lacunarity, float gain) {
	float sum = 0.0;
	float sc = 1.0;
	float totalGain = 1.0;
	for (float i = 0.0; i < 6.0; i++) {
		sum += totalGain * pnoise(P * sc, rep);
		sc *= lacunarity;
		totalGain *= gain;
	}
	return abs(sum);
}

void main() {
	vec2 uv = isf_FragNormCoord;
	float aspect = RENDERSIZE.x / RENDERSIZE.y;
	float a = radians(angle);
	float d = cos(a) * uv.x + sin(a) * uv.y * aspect;
	float t = TIME * speed;
	float noise = turb(vec3(d, d, 0.0) + vec3(t, 0.0, 62.1 + t) * 0.05, vec3(480.0, 320.0, 480.0), lacunarity, gain);
	noise = mix(noise, 0.0, 0.3);
	float mist = noise * mix(1.0, 1.0 - uv.y, fade) * alpha;
	gl_FragColor = vec4(IMG_NORM_PIXEL(inputImage, uv).rgb + vec3(mist), 1.0);
}
