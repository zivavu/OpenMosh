import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "soft-glitch",
	name: "Glitch",
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 50,
			step: 1,
			defaultValue: 15,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0.1,
			max: 5,
			step: 0.1,
			defaultValue: 2,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_amount;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f));
}
vec3 hrot(vec3 c, float a) {
  float ca = cos(a), sa = sin(a);
  vec3 k = vec3(0.57735);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
void main() {
  float strength = u_amount / 50.0;
  float t = u_time;

  // Burst/calm envelope: long quiet stretches, then violent fits
  float burst = smoothstep(0.55, 0.85, vnoise(t * 0.45));
  float activity = strength * (0.15 + 1.6 * burst);

  vec2 readUV = v_uv;
  float hueShift = 0.0;
  float ghost = 0.0;
  float invertFlash = 0.0;

  // 6 bands, each on its OWN clock speed -> poly-rhythm, never one pulse
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float clock = 1.3 + h1(fi * 9.7) * 4.2;
    float et = floor(t * clock);
    if (h1(et * 0.41 + fi * 4.1) > activity + 0.18) continue;

    float top = h1(et * 1.7 + fi * 6.3);
    float ht  = mix(0.02, 0.28, h1(et * 3.1 + fi * 2.9));
    float y = v_uv.y;
    if (y < top || y >= top + ht) continue;

    float typeR = h1(et * 5.3 + fi * 8.7);
    if (typeR < 0.25) {
      float srcY = h1(et * 2.9 + fi * 1.3);
      readUV = vec2(v_uv.x, srcY + fract(y - top) * ht);
    } else if (typeR < 0.5) {
      float xOff = (h1(et * 7.1 + fi) - 0.5) * strength * 1.8;
      readUV = vec2(clamp(v_uv.x + xOff, 0.0, 1.0), y);
      hueShift = h1(et * 3.3 + fi * 5.5) * 6.28;
    } else if (typeR < 0.68) {
      float stripeH = ht / 4.0;
      float srcRow = top + h1(et * 4.4 + fi) * ht * 0.5;
      readUV = vec2(v_uv.x, srcRow + mod(y - top, stripeH));
    } else if (typeR < 0.84) {
      float yOff = (h1(et * 6.2 + fi) - 0.5) * strength * 0.8;
      readUV = vec2(v_uv.x, clamp(y + yOff, 0.0, 1.0));
      hueShift = (h1(et * 1.9 + fi) - 0.5) * 1.2;
    } else {
      ghost = 0.4 + h1(et * 8.8 + fi) * 0.4;
    }
    break;
  }

  // Rare full-frame events, only during bursts
  float ft = floor(t * 14.0);
  if (burst > 0.0 && h1(ft * 0.173) > 1.0 - 0.06 * burst) {
    float kind = h1(ft * 0.731);
    if (kind < 0.45) {
      float tearY = h1(ft * 1.37);
      float off = (h1(ft * 2.11) - 0.5) * strength * 1.2;
      if (readUV.y > tearY) readUV.x = clamp(readUV.x + off, 0.0, 1.0);
    } else if (kind < 0.75) {
      invertFlash = 1.0;
    } else {
      hueShift += 3.14159;
    }
  }

  vec4 s = texture(u_texture, readUV);
  if (ghost > 0.0) {
    vec2 gOff = vec2((h1(floor(t * 3.0) * 7.7) - 0.5) * 0.24 * strength,
                     (h1(floor(t * 3.0) * 3.3) - 0.5) * 0.05);
    vec4 g = texture(u_texture, clamp(v_uv + gOff, vec2(0.0), vec2(1.0)));
    s.rgb = mix(s.rgb, max(s.rgb, g.rgb), ghost);
  }
  if (hueShift != 0.0) s.rgb = hrot(s.rgb, hueShift);
  if (invertFlash > 0.5) s.rgb = 1.0 - s.rgb;
  outColor = s;
}`,
	animated: true,
	setUniforms: floats("amount"),
};
