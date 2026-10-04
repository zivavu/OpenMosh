import { H, setFloat } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "vhs",
	name: "VHS",
	params: [
		{
			key: "static",
			label: "Static",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "speed",
			label: "Speed",
			type: "range",
			min: 0.1,
			max: 5,
			step: 0.1,
			defaultValue: 1,
		},
		{
			key: "tracking",
			label: "Tracking",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_noise;
uniform float u_tracking;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float hash1(float n) {
  return fract(sin(n * 43758.5453) * 28947.3);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 px = 1.0 / res;
  float t = u_time;
  float tFrame = floor(t * 30.0);
  float row = floor(v_uv.y * res.y);
  float colPx = floor(v_uv.x * res.x);

  float hotspot = clamp(0.5 + 0.3 * sin(v_uv.y * 6.0 + t * 0.5)
                            + 0.2 * sin(v_uv.y * 17.0 - t * 0.8), 0.0, 1.0);

  float bandH = 2.0 + hash(vec2(floor(row / 3.0), 444.0)) * 3.0;
  float bandId = floor(row / bandH);
  float lifeLen = 2.0 + floor(hash(vec2(bandId, 123.0)) * 7.0);
  float bandEpoch = floor(tFrame / lifeLen);
  float bandChance = hash(vec2(bandId, bandEpoch * 7.0));
  float isStaticBand = step(1.0 - u_noise * 0.5 * hotspot, bandChance);

  float shiftDir = hash(vec2(bandId, bandEpoch * 13.0 + 50.0)) - 0.5;
  float shiftAmt = isStaticBand * shiftDir * u_noise * 40.0 * px.x;

  float streakX0 = hash(vec2(bandId * 3.0, bandEpoch + 77.0));
  float lenSeed = hash(vec2(bandId * 7.0, bandEpoch + 33.0));
  float streakLen = 0.03 + lenSeed * 0.15 + step(0.8, lenSeed) * 0.12;
  float sx = (v_uv.x - streakX0) / streakLen;
  float inStreak = isStaticBand * step(0.0, sx) * step(sx, 1.0);
  float env = smoothstep(0.0, 0.1, sx) * pow(max(1.0 - sx, 0.0), 1.6);
  float sparkle = 0.5 + 0.5 * hash(vec2(colPx + bandId * 91.0, tFrame));
  float toneSeed = hash(vec2(bandId, bandEpoch * 3.0));
  float dropout = step(0.75, toneSeed);
  float streakSig = inStreak * env * sparkle * (0.45 + toneSeed * 0.55) * u_noise;

  float scanY = floor(v_uv.y * 480.0);
  float lineNoise = (hash(vec2(scanY, floor(t * 10.0))) - 0.5) * u_noise * 4.0 * px.x;
  float warpA = (hash(vec2(floor(v_uv.y * 80.0), floor(t * 6.0))) - 0.5)
    * step(0.75, hash(vec2(floor(v_uv.y * 80.0) + 100.0, floor(t * 6.0))))
    * u_noise * 15.0 * px.x;

  float bars = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float speed = 0.08 + hash1(fi * 7.0 + 1.0) * 0.25;
    float bw = 0.02 + hash1(fi * 13.0 + 3.0) * 0.06;
    float phase = hash1(fi * 19.0 + 5.0);
    float pos = fract(t * speed + phase + sin(t * speed * 3.7 + fi) * 0.08);
    float dist = abs(v_uv.y - pos);
    dist = min(dist, 1.0 - dist);
    float strength = 0.3 + hash1(fi * 11.0 + 9.0) * 0.7;
    bars += smoothstep(bw, 0.0, dist) * strength;
  }
  bars *= u_tracking;
  float barNoise = bars * hash(vec2(colPx, row + tFrame * 31.0));

  float totalWarp = lineNoise + warpA + shiftAmt + bars * 25.0 * px.x;
  float rOff = totalWarp * 1.2;
  float bOff = totalWarp * -0.8;

  vec4 c;
  c.r = texture(u_texture, v_uv + vec2(rOff, 0.0)).r;
  c.g = texture(u_texture, v_uv + vec2(totalWarp * 0.3, 0.0)).g;
  c.b = texture(u_texture, v_uv + vec2(bOff, 0.0)).b;
  c.a = max(texture(u_texture, v_uv + vec2(rOff, 0.0)).a,
            texture(u_texture, v_uv + vec2(bOff, 0.0)).a);

  c.rgb += streakSig * (1.0 - dropout);
  c.rgb -= streakSig * dropout * 1.6;

  float chroma = isStaticBand * u_noise * 0.25;
  c.r += (hash(vec2(colPx * 1.3, row + tFrame)) - 0.5) * chroma;
  c.b += (hash(vec2(colPx * 1.7, row - tFrame)) - 0.5) * chroma;

  c.rgb = mix(c.rgb, vec3(barNoise), min(bars * 0.45, 0.85));

  outColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_noise", v.static as number);
		setFloat(gl, l, "u_tracking", v.tracking as number);
	},
};
