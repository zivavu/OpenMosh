/** Keyed values over time, shared by source edits, effect params and layer placement. */

/** How the value travels from a key to the next one. Absent means linear. */
export type KeyEase = "smooth" | "hold";

export interface Keyframe<T> {
	t: number;
	v: T;
	ease?: KeyEase;
}

/** Two keys are the same key within this many seconds. */
const KEY_EPSILON = 1e-3;

/** How close the playhead must be to count as sitting on a key, for the editing UI. */
export const KEY_NEAR = 0.02;

export function lerp(a: number, b: number, k: number): number {
	return a + (b - a) * k;
}

function eased(ease: KeyEase | undefined, k: number): number {
	if (ease === "hold") return 0;
	if (ease === "smooth") return k * k * (3 - 2 * k);
	return k;
}

/** The keys either side of `time` and how far along between them, eased. A time
 * before the first key or past the last sits on that key. */
export function keySegment<T>(
	keys: Keyframe<T>[],
	time: number,
): { a: Keyframe<T>; b: Keyframe<T>; k: number } | null {
	if (keys.length === 0) return null;
	const first = keys[0];
	if (keys.length === 1 || time <= first.t) return { a: first, b: first, k: 0 };
	const last = keys[keys.length - 1];
	if (time >= last.t) return { a: last, b: last, k: 0 };
	// Linear scan: a hand-placed track is a handful of keys.
	for (let i = 1; i < keys.length; i++) {
		const b = keys[i];
		if (b.t < time) continue;
		const a = keys[i - 1];
		const span = b.t - a.t;
		return { a, b, k: span <= 0 ? 1 : eased(a.ease, (time - a.t) / span) };
	}
	return { a: last, b: last, k: 0 };
}

/** The track's value at `time`, or null when empty. Keys are assumed sorted. */
export function sampleTrack<T>(
	keys: Keyframe<T>[] | undefined,
	time: number,
	blend: (a: T, b: T, k: number) => T,
): T | null {
	if (!keys) return null;
	const seg = keySegment(keys, time);
	if (!seg) return null;
	if (seg.a === seg.b || seg.k === 0) return seg.a.v;
	if (seg.k === 1) return seg.b.v;
	return blend(seg.a.v, seg.b.v, seg.k);
}

export function sampleNumbers(
	keys: Keyframe<number>[] | undefined,
	time: number,
): number | null {
	return sampleTrack(keys, time, lerp);
}

/** `keys` with `v` set at `time`, replacing the key there and keeping its ease.
 * Returns a new sorted array. */
export function putKeyframe<T>(
	keys: Keyframe<T>[] | undefined,
	time: number,
	v: T,
): Keyframe<T>[] {
	const t = Math.max(0, time);
	const replaced = keyframeAt(keys, t);
	const out = (keys ?? []).filter((k) => Math.abs(k.t - t) > KEY_EPSILON);
	out.push(replaced?.ease ? { t, v, ease: replaced.ease } : { t, v });
	out.sort((a, b) => a.t - b.t);
	return out;
}

export function removeKeyframe<T>(
	keys: Keyframe<T>[] | undefined,
	time: number,
): Keyframe<T>[] {
	return (keys ?? []).filter((k) => Math.abs(k.t - time) > KEY_EPSILON);
}

export function keyframeAt<T>(
	keys: Keyframe<T>[] | undefined,
	time: number,
): Keyframe<T> | null {
	return (keys ?? []).find((k) => Math.abs(k.t - time) <= KEY_EPSILON) ?? null;
}

/** The key nearest `time` within `near`, for a UI that can't land exactly on one. */
export function keyNear<T>(
	keys: Keyframe<T>[] | undefined,
	time: number,
	near = KEY_NEAR,
): Keyframe<T> | null {
	let best: Keyframe<T> | null = null;
	for (const k of keys ?? []) {
		const d = Math.abs(k.t - time);
		if (d <= near && (!best || d < Math.abs(best.t - time))) best = k;
	}
	return best;
}

export function isKeyEase(raw: unknown): raw is KeyEase {
	return raw === "smooth" || raw === "hold";
}

/** Sorted, de-duplicated and dropped entirely when nothing survives. Bounded by
 * `max` keys, since a damaged save could list any number. */
export function normalizeTrack<T>(
	raw: unknown,
	value: (raw: unknown) => T,
	max = 1000,
): Keyframe<T>[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	let out: Keyframe<T>[] = [];
	for (const entry of raw.slice(0, max)) {
		const e = entry as Partial<Keyframe<T>> | null;
		const t = e?.t;
		if (typeof t !== "number" || !Number.isFinite(t)) continue;
		out = putKeyframe(out, t, value(e!.v));
		if (isKeyEase(e!.ease)) keyframeAt(out, Math.max(0, t))!.ease = e!.ease;
	}
	return out.length > 0 ? out : undefined;
}
