import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "relief",
	name: "Relief",
	params: [
		{
			key: "amount",
			label: "Depth",
			type: "range",
			min: 0,
			max: 0.8,
			step: 0.005,
			defaultValue: 0.35,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 360,
			step: 1,
			defaultValue: 30,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
uniform float u_angle;

void main() {
  vec3 lum = vec3(0.299, 0.587, 0.114);

  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad));

  // Parallax occlusion mapping: treat luma as a height field. Cast a ray descending
  // from height=1 to 0 while stepping in dir, interpolating the exact intersection.
  const int N = 64;
  vec2  stepUV = dir * u_amount / float(N);
  float stepH  = 1.0 / float(N);

  vec2  pos      = v_uv;
  float rayH     = 1.0;
  vec2  prevPos  = v_uv;
  float prevSurfH = dot(texture(u_texture, v_uv).rgb, lum);
  vec2  hitPos   = v_uv;
  bool  found    = false;

  for (int i = 0; i < N; i++) {
    float surfH = dot(texture(u_texture, pos).rgb, lum);
    if (!found && surfH >= rayH) {
      float prevRayH = rayH + stepH;
      float t = (prevRayH - prevSurfH) / max((surfH - prevSurfH) - (rayH - prevRayH), 0.0001);
      hitPos = mix(prevPos, pos, clamp(t, 0.0, 1.0));
      found  = true;
    }
    prevPos   = pos;
    prevSurfH = surfH;
    pos  += stepUV;
    rayH -= stepH;
  }

  outColor = texture(u_texture, hitPos);
}`,
	setUniforms: floats("amount", "angle"),
};
