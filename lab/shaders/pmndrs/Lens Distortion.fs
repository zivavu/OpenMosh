/*{
	"DESCRIPTION": "Brown–Conrady style radial lens distortion with focal length, principal point and skew: barrel/fisheye one way, pincushion the other. Port of the pmndrs/postprocessing LensDistortionEffect (from ycw/three-lens-distortion).",
	"CREDIT": "pmndrs postprocessing — LensDistortionEffect (port)",
	"LICENSE": "Zlib",
	"SOURCE": "https://github.com/pmndrs/postprocessing/blob/main/src/effects/glsl/lens-distortion.frag",
	"CATEGORIES": ["Lens", "Geometry"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "distortionX", "LABEL": "Distortion X", "TYPE": "float", "MIN": -1, "MAX": 1, "DEFAULT": 0.35 },
		{ "NAME": "distortionY", "LABEL": "Distortion Y", "TYPE": "float", "MIN": -1, "MAX": 1, "DEFAULT": 0.35 },
		{ "NAME": "focalLength", "LABEL": "Focal length", "TYPE": "float", "MIN": 0.3, "MAX": 2, "DEFAULT": 0.75 },
		{ "NAME": "principalPoint", "LABEL": "Principal point", "TYPE": "point2D", "MIN": [-0.5, -0.5], "MAX": [0.5, 0.5], "DEFAULT": [0, 0] },
		{ "NAME": "skew", "LABEL": "Skew", "TYPE": "float", "MIN": -1, "MAX": 1, "DEFAULT": 0 }
	]
}*/

void main() {
	vec2 xn = 2.0 * (isf_FragNormCoord - 0.5);
	vec3 xDistorted = vec3((1.0 + vec2(distortionX, distortionY) * dot(xn, xn)) * xn, 1.0);
	mat3 kk = mat3(
		vec3(focalLength, 0.0, 0.0),
		vec3(skew * focalLength, focalLength, 0.0),
		vec3(principalPoint.x, principalPoint.y, 1.0)
	);
	vec2 uv = (kk * xDistorted).xy * 0.5 + 0.5;
	float inside = float(uv.s >= 0.0 && uv.s <= 1.0 && uv.t >= 0.0 && uv.t <= 1.0);
	gl_FragColor = vec4(IMG_NORM_PIXEL(inputImage, uv).rgb * inside, 1.0);
}
