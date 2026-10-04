import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "grain",
	name: "Grain",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.3,
		},
		{ key: "rgb", label: "RGB", type: "checkbox", defaultValue: 1 },
		{
			key: "blendMode",
			label: "Blend Mode",
			type: "select",
			defaultValue: "additive",
			options: [
				{ label: "Additive", value: "additive" },
				{ label: "Softlight", value: "softlight" },
				{ label: "Multiply", value: "multiply" },
			],
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_rgb;
uniform int u_blendMode;
// Sine-free hash (Dave Hoskins): stable on ANGLE/D3D where fract(sin(x)*K)
// collapses to a constant for large x, which pixel coords hit.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 blendSoftLight(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
    2.0 * base * (1.0 - blend) + sqrt(base) * (2.0 * blend - 1.0),
    step(0.5, blend)
  );
}
void main() {
  vec4 c = texture(u_texture, v_uv);
  float frame = floor(u_time * 24.0);

  // Hard per-pixel speckle: one hash per pixel, no interpolation, so grains
  // re-seat every frame and boil like film.
  vec2 p = floor(gl_FragCoord.xy) + frame * vec2(13.7, 57.3);

  // RGB mode gives each channel its own grain -> colored speckle
  vec3 g = u_rgb > 0.5
    ? vec3(hash(p), hash(p + 19.19), hash(p + 47.47))
    : vec3(hash(p));

  vec3 result;
  if (u_blendMode == 0) {
    // Additive: uniform response, grain reads in shadows and highlights alike
    result = c.rgb + (g - 0.5) * u_amount * 1.2;
  } else if (u_blendMode == 1) {
    result = mix(c.rgb, blendSoftLight(c.rgb, g), u_amount * 1.5);
  } else {
    result = c.rgb * mix(vec3(1.0), g * 1.6, u_amount);
  }
  outColor = vec4(clamp(result, 0.0, 1.0), c.a);
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_amount", v.amount as number);
		setFloat(gl, l, "u_rgb", v.rgb as number);
		const mode =
			v.blendMode === "softlight" ? 1 : v.blendMode === "multiply" ? 2 : 0;
		setInt(gl, l, "u_blendMode", mode);
	},
};
