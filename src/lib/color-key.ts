/** Colour keying shared by the Mask's Key shape and the media key: a key selects
 * pixels within an OKLab distance of its colour, optionally only the patch that
 * runs into the point it was picked at. */

/** One colour a key selects, in the form the matcher and the shaders take. */
export interface KeySpec {
	/** 0..1 per channel. */
	r: number;
	g: number;
	b: number;
	/** Where it was picked, 0..1 of the frame, y down. Seeds a touching key. */
	x: number;
	y: number;
	/** OKLab distance that is fully selected. */
	range: number;
	/** Width of the fade past `range`, in the same units. */
	softness: number;
	/** Only the matching area that runs into the pick point, not every match. */
	touching: boolean;
	/** Off leaves the colour out without forgetting it. */
	on: boolean;
}

/** The most colours one key holds; the shaders' arrays are this long. */
export const MAX_COLOR_KEYS = 8;
/** Ceilings of the per-colour sliders, in OKLab distance. */
export const KEY_RANGE_MAX = 0.5;
export const KEY_SOFTNESS_MAX = 0.3;
export const DEFAULT_KEY_SOFTNESS = 0.04;

function toLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** OKLab of an sRGB colour, 0..1 per channel. Mirrors OKLAB_GLSL. */
export function oklab(
	r: number,
	g: number,
	b: number,
): [number, number, number] {
	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);
	const l = Math.cbrt(
		0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
	);
	const m = Math.cbrt(
		0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
	);
	const s = Math.cbrt(
		0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
	);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function smoothstep(lo: number, hi: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
	return t * t * (3 - 2 * t);
}

/** Softness floor, so a hard edge doesn't divide by zero. */
const MIN_SOFTNESS = 0.0005;

/** How much the keys select of an rgb colour, 0..1. `reached`: the pixel lies in
 * the touching keys' fill. */
export type KeysTest = (
	r: number,
	g: number,
	b: number,
	reached?: boolean,
) => number;

/** The keys compiled for a per-pixel loop. Mirrors keysMatch in KEYS_MATCH_GLSL. */
export function keysTester(keys: KeySpec[]): KeysTest {
	const list = keys
		.slice(0, MAX_COLOR_KEYS)
		.filter((k) => k.on)
		.map((k) => ({
			lab: oklab(k.r, k.g, k.b),
			range: k.range,
			soft: Math.max(k.softness, MIN_SOFTNESS),
			touching: k.touching,
		}));
	return (r, g, b, reached = true) => {
		const [l, a, bb] = oklab(r, g, b);
		let m = 0;
		for (const k of list) {
			if (k.touching && !reached) continue;
			const d = Math.hypot(l - k.lab[0], a - k.lab[1], bb - k.lab[2]);
			m = Math.max(m, 1 - smoothstep(k.range, k.range + k.soft, d));
		}
		return m;
	};
}

export function keysMatch(
	keys: KeySpec[],
	r: number,
	g: number,
	b: number,
	reached = true,
): number {
	return keysTester(keys)(r, g, b, reached);
}

export const OKLAB_GLSL = `vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 oklab(vec3 c) {
  c = toLinear(c);
  vec3 lms = vec3(
    dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
  return vec3(
    dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
    dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
    dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
}
`;

/** What the shaders need per colour, packed for uniform arrays. */
export interface KeyUniforms {
	count: number;
	labs: Float32Array;
	tunes: Float32Array;
	/** 1 per key that only takes the area touching its pick point. */
	touch: Float32Array;
	/** 1 per key that is on. */
	on: Float32Array;
	seeds: Float32Array;
	anyTouching: boolean;
}

export function packKeys(keys: KeySpec[]): KeyUniforms {
	const list = keys.slice(0, MAX_COLOR_KEYS);
	const labs = new Float32Array(MAX_COLOR_KEYS * 3);
	const tunes = new Float32Array(MAX_COLOR_KEYS * 2);
	const touch = new Float32Array(MAX_COLOR_KEYS);
	const on = new Float32Array(MAX_COLOR_KEYS);
	const seeds = new Float32Array(MAX_COLOR_KEYS * 2);
	list.forEach((k, i) => {
		labs.set(oklab(k.r, k.g, k.b), i * 3);
		tunes.set([k.range, Math.max(k.softness, MIN_SOFTNESS)], i * 2);
		touch[i] = k.touching ? 1 : 0;
		on[i] = k.on ? 1 : 0;
		seeds.set([k.x, k.y], i * 2);
	});
	const anyTouching = list.some((k) => k.touching && k.on);
	return { count: list.length, labs, tunes, touch, on, seeds, anyTouching };
}

/** The per-colour uniforms and the OKLab conversion. */
export const COLOR_KEYS_GLSL = `uniform float u_keyCount;
uniform vec3 u_keyLab[${MAX_COLOR_KEYS}];
uniform vec2 u_keyTune[${MAX_COLOR_KEYS}];
uniform float u_keyTouch[${MAX_COLOR_KEYS}];
uniform float u_keyOn[${MAX_COLOR_KEYS}];
${OKLAB_GLSL}`;

/** keysMatch on the GPU. The includer defines keyReach: g of the touching fill at uv. */
export const KEYS_MATCH_GLSL = `${COLOR_KEYS_GLSL}
float keyReach(vec2 uv);
// The colours that are on, or just colour number "only" (on or not) when it is >= 0.
float keysMatch(vec3 lab, vec2 uv, float only) {
  float m = 0.0;
  float reach = -1.0;
  for (int i = 0; i < ${MAX_COLOR_KEYS}; i++) {
    if (float(i) >= u_keyCount) break;
    if (only >= 0.0 ? float(i) != only : u_keyOn[i] < 0.5) continue;
    vec2 t = u_keyTune[i];
    float k = 1.0 - smoothstep(t.x, t.x + t.y, distance(lab, u_keyLab[i]));
    if (u_keyTouch[i] > 0.5) {
      if (reach < 0.0) reach = keyReach(uv);
      k *= reach;
    }
    m = max(m, k);
  }
  return m;
}
`;

/** Seed of the touching fill: r = matches a touching key, g = and sits by its pick
 * point. Spread by ReachFill. */
export const KEY_REACH_SEED_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
${COLOR_KEYS_GLSL}
uniform vec2 u_keySeeds[${MAX_COLOR_KEYS}];
// Seed half-width, in texels of this buffer.
uniform float u_seedRadius;
uniform vec2 u_reachSize;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec3 lab = oklab(texture(u_texture, v_uv).rgb);
  float pass = 0.0;
  float seeded = 0.0;
  for (int i = 0; i < ${MAX_COLOR_KEYS}; i++) {
    if (float(i) >= u_keyCount) break;
    if (u_keyTouch[i] < 0.5 || u_keyOn[i] < 0.5) continue;
    vec2 t = u_keyTune[i];
    if (distance(lab, u_keyLab[i]) < t.x + t.y) pass = 1.0;
    vec2 d = abs(v_uv - u_keySeeds[i]) * u_reachSize;
    if (max(d.x, d.y) <= u_seedRadius) seeded = 1.0;
  }
  outColor = vec4(pass, pass * seeded, 0.0, 1.0);
}`;

/** Sets the key arrays on any program built on COLOR_KEYS_GLSL. */
export function setKeyUniforms(
	gl: WebGL2RenderingContext,
	l: Record<string, WebGLUniformLocation>,
	keys: KeyUniforms,
) {
	if (l["u_keyCount"]) gl.uniform1f(l["u_keyCount"], keys.count);
	if (l["u_keyLab[0]"]) gl.uniform3fv(l["u_keyLab[0]"], keys.labs);
	if (l["u_keyTune[0]"]) gl.uniform2fv(l["u_keyTune[0]"], keys.tunes);
	if (l["u_keyTouch[0]"]) gl.uniform1fv(l["u_keyTouch[0]"], keys.touch);
	if (l["u_keyOn[0]"]) gl.uniform1fv(l["u_keyOn[0]"], keys.on);
	if (l["u_keySeeds[0]"]) gl.uniform2fv(l["u_keySeeds[0]"], keys.seeds);
}
