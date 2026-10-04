import {
	BOUNCE_GLSL,
	H,
	HUE_ROTATE_GLSL,
	NOISE_GLSL,
	floats,
} from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "fiber-displace",
	name: "Fiber Displace",
	params: [
		{
			key: "strength",
			label: "Pull",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.4,
		},
		{
			key: "density",
			label: "Fiber Density",
			type: "range",
			min: 2,
			max: 80,
			step: 1,
			defaultValue: 30,
		},
		{
			key: "comb",
			label: "Comb",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.55,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: 0,
			max: 360,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "chrome",
			label: "Sheen",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.4,
		},
		{
			key: "smoothness",
			label: "Silk",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.3,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		BOUNCE_GLSL +
		NOISE_GLSL +
		HUE_ROTATE_GLSL +
		`uniform float u_strength;
uniform float u_density;
uniform float u_comb;
uniform float u_angle;
uniform float u_chrome;
uniform float u_smoothness;
uniform vec2 u_resolution;

#define FIBER_TAPS 14

void main() {
  // Work in an aspect-corrected frame so the weave keeps its angle on non-square images.
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(sin(rad), cos(rad));   // along a thread
  vec2 nrm = vec2(dir.y, -dir.x);        // across the weave

  vec2 p = v_uv * aspect;
  float across = dot(p, nrm) * u_density;
  float along = dot(p, dir);

  // Silk: band-limited noise across the weave that also drifts down each thread,
  // so a fiber's pull changes as it runs.
  float silk = fbm(vec2(across * 0.7, along * 1.7)) * 2.0 - 1.0;

  // Shred: one constant pull per thread. The cell boundary is widened to a pixel
  // with fwidth, so cranking density dissolves the weave into a soft grain.
  float cell = floor(across);
  float aa = clamp(fwidth(across), 0.02, 1.0);
  float w0 = vnoise(vec2(cell * 1.37, along * 1.7)) * 2.0 - 1.0;
  float w1 = vnoise(vec2((cell + 1.0) * 1.37, along * 1.7)) * 2.0 - 1.0;
  float shred = mix(w0, w1, smoothstep(1.0 - aa, 1.0, fract(across)));

  float fiber = mix(shred, silk, u_smoothness);
  float disp = fiber * u_strength * 0.18;

  // Walk the pull and accumulate, so each thread reads as image drawn out along its
  // length. Each channel gets its own weight profile over the same taps, so fringing is free.
  float d = u_chrome * 0.3;
  vec3 centers = vec3(1.0, 1.0 - d * 0.5, 1.0 - d);
  vec3 acc = vec3(0.0);
  vec3 total = vec3(0.0);
  float accA = 0.0;
  float totalA = 0.0;
  for (int i = 0; i < FIBER_TAPS; i++) {
    float t = float(i) / float(FIBER_TAPS - 1);
    vec2 uv = v_uv + dir * disp * t;
    vec4 s = texture(u_texture, vec2(bounce(uv.x), bounce(uv.y)));
    // Comb 0 keeps a narrow bump at the end of the walk, one clean pull. Comb 1
    // weights the whole path, which reads as a combed-out fiber.
    vec3 dt = vec3(t) - centers;
    vec3 w = mix(exp(-60.0 * dt * dt), 1.0 - smoothstep(vec3(-0.08), vec3(0.08), dt), u_comb);
    acc += s.rgb * w;
    total += w;
    accA += s.a * w.g;
    totalA += w.g;
  }
  vec3 col = acc / max(total, vec3(1e-4));
  float alpha = accA / max(totalA, 1e-4);

  // Sheen: light each thread as a cylinder, so the highlight is a smooth band down
  // the fiber. Deriving it from fwidth(fiber) instead spikes on the discontinuities.
  float xr = fract(across) * 2.0 - 1.0;      // position across one thread
  float nz = sqrt(max(1.0 - xr * xr, 0.0));  // cylinder normal, facing viewer
  float ndl = clamp(xr * -0.55 + nz * 0.84, 0.0, 1.0);

  // A thread a pixel or two wide can't carry a tight highlight, so widen and dim it
  // as the weave goes sub-pixel rather than let it alias.
  float thin = smoothstep(0.15, 0.6, aa);
  float spec = pow(ndl, mix(24.0, 3.0, thin)) * mix(1.0, 0.55, thin);

  // Vary the glint per thread so the weave doesn't read as one even sheet.
  spec *= 0.4 + 0.6 * abs(fiber);

  // Iridescence shifts with the viewing angle, like an oil film, and stays inside a
  // narrow arc so neighbouring threads keep a family resemblance.
  float shift = (xr * 0.75 + fiber * 0.25) * 24.0;
  col = hueRotate(col, shift * u_chrome);

  // The sheen carries no colour of its own: it scales the thread's existing colour,
  // so a lit fiber keeps its hue and simply gets more light.
  float sh = clamp(spec * u_chrome, 0.0, 1.0);
  col *= 1.0 + sh * 1.6;
  col *= 1.0 - u_chrome * 0.22 * (1.0 - nz) * (1.0 - thin);

  // Roll off on the brightest channel. A per-channel clamp would pin the other two
  // below it and desaturate the peaks to white.
  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.0, 0.0);

  // Ease the threads that ended up on the gamut edge back off it. Saturation pinned
  // at full is the other half of the plastic look; only the worst offenders are touched.
  float lo = min(min(col.r, col.g), col.b);
  float sat = max(max(col.r, col.g), col.b) - lo;
  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(grey), smoothstep(0.6, 1.0, sat) * 0.3 * u_chrome);

  outColor = vec4(clamp(col, 0.0, 1.0), alpha);
}`,
	linearFilter: true,
	setUniforms: floats(
		"strength",
		"density",
		"comb",
		"angle",
		"chrome",
		"smoothness",
	),
};
