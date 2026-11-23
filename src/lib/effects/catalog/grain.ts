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
uniform vec2 u_resolution;
// PCG integer hash: no float precision loss, so no visible tiling at any size.
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
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
  // Per-pixel noise, then a gaussian blur sized in effect-frame pixels: soft grains with
  // no hard pixel edges, so a scaled preview can't beat them into a grid, and the grain
  // keeps its size in an export.
  float scale = 1.0 / (abs(dFdx(v_uv.x)) * u_resolution.x);
  float sigma = clamp(0.7 * scale, 0.7, 1.2);
  uint frame = uint(max(floor(u_time * 24.0), 0.0));
  ivec2 px = ivec2(gl_FragCoord.xy) + 4;
  vec3 sum = vec3(0.0);
  float wSum = 0.0;
  float w2Sum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float w = exp(-float(x * x + y * y) / (2.0 * sigma * sigma));
      uvec3 h = pcg3d(uvec3(uvec2(px + ivec2(x, y)), frame));
      sum += w * vec3(h) * (1.0 / 4294967296.0);
      wSum += w;
      w2Sum += w * w;
    }
  }
  // Blurring lowers the spread; scale it back to that of one pixel's noise.
  vec3 n = (sum / wSum - 0.5) * (wSum / sqrt(w2Sum));
  vec3 g = clamp(0.5 + (u_rgb > 0.5 ? n : vec3(n.x)), 0.0, 1.0);

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
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_amount", v.amount as number);
		setFloat(gl, l, "u_rgb", v.rgb as number);
		const mode =
			v.blendMode === "softlight" ? 1 : v.blendMode === "multiply" ? 2 : 0;
		setInt(gl, l, "u_blendMode", mode);
	},
	animated: true,
};
