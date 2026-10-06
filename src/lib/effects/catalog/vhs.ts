import { H, NOISE_GLSL, setFloat } from "../../gl/shader-lib";
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
		NOISE_GLSL +
		`uniform float u_noise;
uniform float u_tracking;
// Sine-free, so per-pixel seeds don't line up into visible columns.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hue(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
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

  // Phases: busy and quiet spells, and patches that drift, swell and fade,
  // with quick bursts on top.
  float tick = mod(floor(t * 15.0), 997.0);
  float burst = 0.6 + pow(hash12(vec2(tick, 3.1)), 3.0) * 1.6;
  float spell = smoothstep(0.25, 0.75, vnoise(vec2(t * 0.6, 5.3)));
  float area = 0.25 + 0.75 * smoothstep(0.3, 0.75,
    vnoise(v_uv * vec2(1.6, 1.2) + vec2(t * 0.25, t * 0.7)));
  // Waves: a band that rolls down the frame now and then, and a busy zone that
  // wanders, lingering near the top or the bottom.
  float rollY = fract(t * 0.16 + 0.4 * vnoise(vec2(t * 0.2, 1.7)));
  float rollD = abs(v_uv.y - rollY);
  rollD = min(rollD, 1.0 - rollD) / 0.12;
  float roll = exp(-rollD * rollD) * smoothstep(0.35, 0.65, vnoise(vec2(t * 0.35, 2.2)));
  float zoneY = smoothstep(0.2, 0.8, vnoise(vec2(t * 0.15, 9.1)));
  float zoneD = (v_uv.y - zoneY) / 0.25;
  float wave = 0.2 + 1.8 * max(roll, 0.8 * exp(-zoneD * zoneD));
  float density = u_noise * u_noise * burst * (0.3 + 1.4 * spell) * area * wave;
  float fr = mod(tFrame, 997.0);
  float lineV = floor(v_uv.y * 480.0);

  // Flecks: a haze of faint short dashes, the grain of the static. Every line
  // gets its own spacing and offset each frame, so nothing lines up.
  float fw = 0.006 + hash12(vec2(lineV, fr + 3.0)) * 0.014;
  float fxs = v_uv.x / fw + hash12(vec2(lineV, fr + 19.0)) * 32.0;
  vec2 fSeed = vec2(floor(fxs), lineV * 1.3 + fr * 17.0);
  vec3 fleck = vec3(0.0);
  if (hash12(fSeed) < density * 0.35) {
    float fx = fract(fxs);
    vec3 tint = mix(hue(hash12(fSeed + 4.0)), vec3(1.0), 0.3);
    fleck = tint * smoothstep(0.0, 0.3, fx) * smoothstep(1.0, 0.6, fx)
      * (0.18 + 0.32 * hash12(fSeed + 2.0));
  }

  // Streaks: rarer bright dashes, one to three lines thick, short to long.
  float streak = 0.0;
  vec3 streakCol = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float owner = lineV - float(k);
    float cw = 0.06 + hash12(vec2(owner, fr + 7.0)) * 0.12;
    float xs = v_uv.x / cw + hash12(vec2(owner, fr + 41.0)) * 16.0;
    vec2 sd = vec2(floor(xs), owner * 1.7 + fr * 13.0);
    if (hash12(sd) >= density * 0.05) continue;
    float thick = 1.0 + floor(pow(hash12(sd + 1.0), 3.0) * 3.0);
    if (float(k) >= thick) continue;
    float len = 0.2 + 0.8 * pow(hash12(sd + 3.0), 1.5);
    float sx = (fract(xs) - hash12(sd + 5.0) * (1.0 - len)) / len;
    if (sx < 0.0 || sx > 1.0) continue;
    // White core, ragged ends that lean toward a colour of their own.
    float core = pow(sin(sx * 3.14159), 0.6);
    float grain = 0.7 + 0.3 * hash12(vec2(floor(v_uv.x * res.x * 0.5), owner + fr));
    float sig = core * grain * (0.6 + 0.4 * hash12(sd + 9.0));
    vec3 ends = mix(hue(hash12(sd + 11.0)), hue(hash12(sd + 13.0)), sx);
    vec3 col = mix(mix(ends, vec3(1.0), 0.4), vec3(1.0), core * core);
    if (sig > streak) {
      streak = sig;
      streakCol = col * sig;
    }
  }
  float shiftAmt = streak * u_noise * 4.0 * px.x;

  float scanY = floor(v_uv.y * 480.0);
  float lineNoise = (hash(vec2(scanY, floor(t * 10.0))) - 0.5) * u_noise * burst * 3.0 * px.x;
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

  // Colour grain, heaviest where the static is busy.
  vec2 grainCell = floor(v_uv * vec2(360.0, 480.0)) + fr * vec2(1.31, 2.17);
  float grainOn = hash12(grainCell) < u_noise * (0.04 + 0.2 * min(density, 1.0)) ? 1.0 : 0.0;
  vec3 grainDot = grainOn * hue(hash12(grainCell + 9.0)) * (0.15 + 0.3 * hash12(grainCell + 17.0));
  vec3 lift = max(streakCol, fleck) + grainDot;
  c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - clamp(lift, 0.0, 1.0));

  c.rgb = mix(c.rgb, vec3(barNoise), min(bars * 0.45, 0.85));

  outColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_noise", v.static as number);
		setFloat(gl, l, "u_tracking", v.tracking as number);
	},
};
