/*{
	"DESCRIPTION": "Lens chromatic aberration: red and blue scale apart towards the edges (lateral), and bright edges bleed purple fringes (axial, from a Poisson-disk blur). Port of KinoFringe; lateral range widened for stylised use.",
	"CREDIT": "Keijiro Takahashi — KinoFringe (port)",
	"LICENSE": "MIT",
	"SOURCE": "https://github.com/keijiro/KinoFringe",
	"CATEGORIES": ["Lens", "Color", "Kino"],
	"INPUTS": [
		{ "NAME": "inputImage", "TYPE": "image" },
		{ "NAME": "lateralShift", "LABEL": "Lateral shift", "TYPE": "float", "MIN": 0, "MAX": 10, "DEFAULT": 6 },
		{ "NAME": "axialStrength", "LABEL": "Axial strength", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.8 },
		{ "NAME": "axialShift", "LABEL": "Axial shift", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 }
	]
}*/

const vec2 POISSON[16] = vec2[16](
	vec2(0.0984258332809, 0.918808284462), vec2(0.00259138629413, -0.999838959623),
	vec2(-0.987959729023, -0.00429660140761), vec2(0.981234239267, -0.140666219895),
	vec2(-0.0212157973013, -0.0443286928994), vec2(-0.652058534734, 0.695078086985),
	vec2(-0.68090417832, -0.681862769398), vec2(0.779643686501, 0.603399060386),
	vec2(0.67941165083, -0.731372789969), vec2(0.468821477499, -0.251621416756),
	vec2(0.278991228738, 0.39302189329), vec2(-0.191188273806, -0.527976638433),
	vec2(-0.464789669525, 0.216311272754), vec2(-0.559833960421, -0.256176089172),
	vec2(0.65988403582, 0.170056284903), vec2(-0.170289189543, 0.551561042407)
);

float luminance(vec3 rgb) { return dot(rgb, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
	vec2 uv = isf_FragNormCoord;
	// _CameraAspect = (h/w, w/h, 1, 0)
	vec4 aspect = vec4(RENDERSIZE.y / RENDERSIZE.x, RENDERSIZE.x / RENDERSIZE.y, 1.0, 0.0);
	vec2 spc = (uv - 0.5) * aspect.xz;
	float r2 = dot(spc, spc);
	float f_r = 1.0 + r2 * lateralShift * -0.02;
	float f_b = 1.0 + r2 * lateralShift * 0.02;

	vec4 src = IMG_NORM_PIXEL(inputImage, uv);
	src.r = IMG_NORM_PIXEL(inputImage, (uv - 0.5) * f_r + 0.5).r;
	src.b = IMG_NORM_PIXEL(inputImage, (uv - 0.5) * f_b + 0.5).b;

	vec3 blur = vec3(0.0);
	for (int i = 0; i < 16; i++)
		blur += IMG_NORM_PIXEL(inputImage, uv + POISSON[i] * aspect.yz * axialShift * 0.02).rgb;
	blur /= 16.0;
	float ldiff = luminance(blur) - luminance(src.rgb);
	src.rb = max(src.rb, blur.rb * ldiff * axialStrength);
	gl_FragColor = vec4(src.rgb, 1.0);
}
