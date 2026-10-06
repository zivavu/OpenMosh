import { hexToVec3 } from "../color";
import {
	DEFAULT_KEY_SOFTNESS,
	KEY_RANGE_MAX,
	KEY_SOFTNESS_MAX,
	MAX_COLOR_KEYS,
	packKeys,
	type KeySpec,
	type KeyUniforms,
} from "../color-key";

/** One colour a Mask's Key shape selects, as stored: the colour as hex. */
export interface ColorKey extends Omit<KeySpec, "r" | "g" | "b"> {
	/** #rrggbb, sampled from the picture where the Mask's scope starts. */
	color: string;
}

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
			touching: o.touching === true,
			on: o.on !== false,
		});
		if (keys.length === MAX_COLOR_KEYS) break;
	}
	return keys;
}

export function serializeKeys(keys: ColorKey[]): string {
	return keys.length ? JSON.stringify(keys) : "";
}

/** Packed per stored string: setUniforms runs every frame. */
const packed = new Map<string, KeyUniforms>();

export function keyUniforms(raw: string): KeyUniforms {
	let held = packed.get(raw);
	if (held) return held;
	held = packKeys(
		parseKeys(raw).map(({ color, ...k }) => {
			const [r, g, b] = hexToVec3(color);
			return { ...k, r, g, b };
		}),
	);
	// A range drag mints a string per tick; don't grow forever.
	if (packed.size > 64) packed.clear();
	packed.set(raw, held);
	return held;
}
