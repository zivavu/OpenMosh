/** Shared pieces of the spec type guards. */

const HEX = /^#[0-9a-f]{6}$/i;

export function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object";
}

export function allFinite(s: Record<string, unknown>, keys: string[]): boolean {
	return keys.every((k) => typeof s[k] === "number" && Number.isFinite(s[k]));
}

/** A whole-number seed for mulberry32. */
export function isSeed(v: unknown): v is number {
	return Number.isInteger(v) && (v as number) >= 0 && (v as number) < 2 ** 32;
}

/** Drawn generators can leave their ground clear; absent means opaque. */
export function isTransparentFlag(v: unknown): boolean {
	return v === undefined || v === true;
}

export function isColors(v: unknown): boolean {
	return (
		Array.isArray(v) &&
		v.length === 5 &&
		v.every((c) => typeof c === "string" && HEX.test(c))
	);
}
