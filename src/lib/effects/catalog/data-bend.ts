import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "data-bend",
	name: "Data Bend",
	params: [
		{
			key: "intensity",
			label: "Intensity",
			type: "range",
			min: 0,
			max: 100,
			step: 1,
			defaultValue: 30,
		},
		{
			key: "corruption",
			label: "Corruption",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.3,
		},
		{
			key: "channelShift",
			label: "Channel Shift",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.2,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0.5,
			max: 20,
			step: 0.5,
			defaultValue: 4,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_intensity;
uniform float u_corruption;
uniform float u_channelShift;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
vec3 hrot(vec3 c, float a) {
  float ca = cos(a), sa = sin(a);
  vec3 k = vec3(0.57735);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  // Corruption layout persists: quantize phase-time coarsely
  float t = floor(u_time * 0.8);

  // Macroblock grid (raster order, like bytes in a file)
  float gridW = 40.0;
  float gridH = max(4.0, floor(gridW * res.y / res.x));
  vec2 grid = vec2(gridW, gridH);
  vec2 bc = floor(v_uv * grid);
  vec2 local = fract(v_uv * grid);
  float bIdx = bc.y * gridW + bc.x;
  float total = gridW * gridH;

  float numZones = floor(2.0 + u_corruption * 10.0);

  vec2 readBlock = bc;
  vec2 readLocal = local;
  float rasterShift = 0.0;
  float garbage = 0.0;
  float hueG = 0.0;

  for (float i = 0.0; i < 12.0; i++) {
    if (i >= numZones) break;
    // Corrupt zones are runs of consecutive blocks in raster order, wrapping row edges.
    float zStart = floor(hash(vec2(i, t)) * total);
    float zLen = floor((0.01 + hash(vec2(i + 50.0, t)) * 0.06)
      * total * (0.3 + u_intensity));
    float zEnd = zStart + zLen;

    // The classic databend signature: everything after the broken bytes stays shifted.
    if (bIdx >= zEnd) {
      rasterShift += floor((hash(vec2(i * 3.0, t + 7.0)) - 0.5)
        * u_intensity * 7.0);
    }

    if (bIdx >= zStart && bIdx < zEnd) {
      float fate = hash(vec2(i * 11.0, t + 3.0));
      if (fate < 0.45) {
        float srcIdx = mod(bIdx + floor((hash(vec2(i * 5.0, t)) - 0.5)
          * total * 0.5) + total, total);
        readBlock = vec2(mod(srcIdx, gridW), floor(srcIdx / gridW));
      } else if (fate < 0.75) {
        // smear: the block repeats its first row downward (JPEG streak)
        readLocal.y = readLocal.y * 0.08;
      } else {
        garbage = 1.0;
        hueG = hash(vec2(i * 7.0, t + 9.0)) * 6.28;
        readBlock.x = mod(readBlock.x + floor(hash(vec2(i, t + 4.0)) * 8.0), gridW);
      }
    }
  }

  float rIdx = readBlock.y * gridW + readBlock.x + rasterShift;
  rIdx = clamp(rIdx, 0.0, total - 1.0);
  vec2 rb = vec2(mod(rIdx, gridW), floor(rIdx / gridW));
  vec2 uv = (rb + readLocal) / grid;

  // RGB byte misalignment: channels offset by fractions of a block
  float co = u_channelShift * 2.5 / gridW;
  vec3 col;
  col.r = texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0))).r;
  col.g = texture(u_texture, clamp(uv + vec2(co, 0.0), vec2(0.0), vec2(1.0))).g;
  col.b = texture(u_texture, clamp(uv + vec2(co * 2.0, 0.0), vec2(0.0), vec2(1.0))).b;
  float alpha = texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0))).a;

  if (garbage > 0.5) {
    col = floor(col * 5.0) / 5.0;
    col = hrot(col, hueG);
  }
  outColor = vec4(col, alpha);
}`,
	animated: true,
	setUniforms: floats("intensity", "corruption", "channelShift"),
};
