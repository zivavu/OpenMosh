import { hexToVec3 } from "../color";

/** One colour a Mask's Key shape selects, and how far around it. */
export interface ColorKey {
	/** #rrggbb, sampled from the picture where the Mask's scope starts. */
	color: string;
	/** Where it was picked, 0..1 of the chain's frame, y down. */
	x: number;
	y: number;
	/** OKLab distance that is fully selected. */
	range: number;
	/** Width of the fade past `range`, in the same units. */
	softness: number;
}

/** The most keys one Mask holds; the shader's arrays are this long. */
export const MAX_COLOR_KEYS = 8;
/** Ceilings of the per-key sliders, in OKLab distance. */
export const KEY_RANGE_MAX = 0.5;
export const KEY_SOFTNESS_MAX = 0.3;
export const DEFAULT_KEY_SOFTNESS = 0.04;

const HEX = /^#[0-9a-f]{6}$/i;

function unit(n: unknown, max: number, fallback: number): number {
	return typeof n === "number" && Number.isFinite(n)
		? Math.min(max, Math.max(0, n))
		: fallback;
}

/** The keys stored in a Mask's param; anything malformed is dropped. */
export function parseKeys(raw: unknown): ColorKey[] {
	if (typeof raw !== "string" || !raw) return [];
	let list: unknown;
	try {
		list = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(list)) return [];
	const keys: ColorKey[] = [];
	for (const k of list) {
		if (!k || typeof k !== "object") continue;
		const c = (k as { color?: unknown }).color;
		if (typeof c !== "string" || !HEX.test(c)) continue;
		const o = k as Record<string, unknown>;
		keys.push({
			color: c.toLowerCase(),
			x: unit(o.x, 1, 0.5),
			y: unit(o.y, 1, 0.5),
			range: unit(o.range, KEY_RANGE_MAX, 0.1),
			softness: unit(o.softness, KEY_SOFTNESS_MAX, DEFAULT_KEY_SOFTNESS),
		});
		if (keys.length === MAX_COLOR_KEYS) break;
	}
	return keys;
}

export function serializeKeys(keys: ColorKey[]): string {
	return keys.length ? JSON.stringify(keys) : "";
}

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

/** What the shader needs per key, packed for uniform arrays. */
export interface KeyUniforms {
	count: number;
	labs: Float32Array;
	tunes: Float32Array;
}

/** Packed per stored string: setUniforms runs every frame. */
const packed = new Map<string, KeyUniforms>();

export function keyUniforms(raw: string): KeyUniforms {
	let held = packed.get(raw);
	if (held) return held;
	const keys = parseKeys(raw);
	const labs = new Float32Array(MAX_COLOR_KEYS * 3);
	const tunes = new Float32Array(MAX_COLOR_KEYS * 2);
	keys.forEach((k, i) => {
		const [r, g, b] = hexToVec3(k.color);
		labs.set(oklab(r, g, b), i * 3);
		tunes.set([k.range, Math.max(k.softness, 0.0005)], i * 2);
	});
	held = { count: keys.length, labs, tunes };
	// A range drag mints a string per tick; don't grow forever.
	if (packed.size > 64) packed.clear();
	packed.set(raw, held);
	return held;
}
