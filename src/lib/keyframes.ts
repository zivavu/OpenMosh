/** Keyed values over time, shared by source edits, effect params and layer placement. */

/** How the value travels from a key to the next one. Absent means linear. "in"
 * starts slow and speeds up into the next key; "out" starts fast and settles. */
export const KEY_EASES = [
	"smooth",
	"in",
	"out",
	"overshoot",
	"bounce",
	"hold",
] as const;

export type KeyEase = (typeof KEY_EASES)[number];

export interface Keyframe<T> {
	t: number;
	v: T;
	ease?: KeyEase;
}

/** Two keys are the same key within this many seconds. */
const KEY_EPSILON = 1e-3;

/** How far an arrow key nudges a key in time: a frame at 30fps. */
export const NUDGE_SEC = 1 / 30;

/** How close the playhead must be to count as sitting on a key, for the editing UI. */
export const KEY_NEAR = 0.02;

export function lerp(a: number, b: number, k: number): number {
	return a + (b - a) * k;
}

/** How far along a key's stretch the value is, `k` of the way through in time.
 * Overshoot runs past 1 before it settles; the rest stay in 0..1. */
export function eased(ease: KeyEase | undefined, k: number): number {
	switch (ease) {
		case "hold":
			return 0;
		case "smooth":
			return k * k * (3 - 2 * k);
		case "in":
			return k * k * k;
		case "out":
			return 1 - (1 - k) ** 3;
		case "overshoot": {
			const c = 1.70158;
			return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
		}
		case "bounce":
			return bounce(k);
		default:
			return k;
	}
}

function bounce(k: number): number {
	const n = 7.5625;
	const d = 2.75;
	if (k < 1 / d) return n * k * k;
	if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
	if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
	return n * (k -= 2.625 / d) * k + 0.984375;
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
	return (KEY_EASES as readonly unknown[]).includes(raw);
}

/** Sorted, de-duplicated and dropped entirely when nothing survives. Bounded by
 * `max` keys, since a damaged save could list any number. Keys before 0 stay: a
 * trimmed or split clip's start hides them. */
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
		const key: Keyframe<T> = { t, v: value(e!.v) };
		if (isKeyEase(e!.ease)) key.ease = e!.ease;
		out = removeKeyframe(out, t);
		out.push(key);
	}
	out.sort((a, b) => a.t - b.t);
	return out.length > 0 ? out : undefined;
}

/** Keys this close count as one moment when several tracks are shown as one. */
export const SAME_MOMENT = 1e-3;

/** Every moment any of the tracks has a key, sorted, with keys that coincide merged. */
export function keyTimesOf(tracks: Iterable<Keyframe<unknown>[]>): number[] {
	const times: number[] = [];
	for (const keys of tracks) for (const k of keys) times.push(k.t);
	times.sort((a, b) => a - b);
	const out: number[] = [];
	for (const t of times)
		if (out.length === 0 || t - out[out.length - 1] > SAME_MOMENT) out.push(t);
	return out;
}

/** The ease the keys at `time` share: undefined when linear, "mixed" when they differ. */
export function easeAtIn(
	tracks: Iterable<Keyframe<unknown>[]>,
	time: number,
): KeyEase | "mixed" | undefined {
	let ease: KeyEase | undefined | null = null;
	for (const keys of tracks) {
		const k = keyframeAt(keys, time);
		if (!k) continue;
		if (ease === null) ease = k.ease;
		else if (ease !== k.ease) return "mixed";
	}
	return ease ?? undefined;
}

/** The key at `from` moved to `to`, landing on whatever sat there. */
export function moveKey<T>(
	keys: Keyframe<T>[],
	from: number,
	to: number,
): Keyframe<T>[] {
	const k = keyframeAt(keys, from);
	if (!k) return keys;
	const moved = putKeyframe(removeKeyframe(keys, k.t), to, k.v);
	if (k.ease) keyframeAt(moved, Math.max(0, to))!.ease = k.ease;
	return moved;
}

export function setEaseAt<T>(
	keys: Keyframe<T>[],
	time: number,
	ease: KeyEase | undefined,
): Keyframe<T>[] {
	return keys.map((k) => {
		if (Math.abs(k.t - time) > SAME_MOMENT) return k;
		const { ease: _, ...plain } = k;
		return ease ? { ...plain, ease } : plain;
	});
}

export function shiftKeys<T>(
	keys: Keyframe<T>[],
	delta: number,
): Keyframe<T>[] {
	return keys.map((k) => ({ ...k, t: k.t + delta }));
}

/** How long a repeat takes to jump back to the start of its run, when the run
 * doesn't end where it began. */
const REPEAT_JUMP = 1 / 120;

/** The run from `first` lasting `span` played again and again up to `end`. A run
 * that ends on its start value loops seamlessly; one that doesn't jumps back. */
export function repeatKeys<T>(
	keys: Keyframe<T>[],
	first: number,
	span: number,
	end: number,
): Keyframe<T>[] {
	if (span <= SAME_MOMENT) return keys;
	// Bounded however short the run: a crafted clip can't make this spin.
	const cycles = Math.min(Math.floor((end - first) / span), 1000);
	const run = keys.filter(
		(k) => k.t >= first - SAME_MOMENT && k.t <= first + span + SAME_MOMENT,
	);
	let out = keys;
	for (let n = 1; n <= cycles; n++) {
		for (const [i, k] of run.entries()) {
			let t = k.t + n * span;
			if (t > end + SAME_MOMENT) break;
			const there = keyframeAt(out, t);
			if (i === 0 && there) {
				if (there.v === k.v) continue;
				t += REPEAT_JUMP;
			}
			out = putKeyframe(out, t, k.v);
			if (k.ease) keyframeAt(out, t)!.ease = k.ease;
		}
	}
	return out;
}

/** The keys at `times` laid down again every `period` seconds, up to `end`. */
export function repeatKeysEvery<T>(
	keys: Keyframe<T>[],
	times: readonly number[],
	period: number,
	end: number,
): Keyframe<T>[] {
	if (period <= SAME_MOMENT) return keys;
	const run = keys.filter((k) => hasTime(times, k.t));
	if (run.length === 0) return keys;
	// Bounded however short the period: a crafted clip can't make this spin.
	const cycles = Math.min(Math.floor((end - run[0].t) / period), 1000);
	let out = keys;
	for (let n = 1; n <= cycles; n++)
		for (const k of run) {
			const t = k.t + n * period;
			if (t > end + SAME_MOMENT) break;
			out = putKeyframe(out, t, k.v);
			const placed = keyframeAt(out, t)!;
			if (k.ease) placed.ease = k.ease;
			else delete placed.ease;
		}
	return out;
}

function hasTime(times: readonly number[], t: number): boolean {
	return times.some((x) => Math.abs(x - t) <= SAME_MOMENT);
}

/** The keys at `times` moved by `delta`, landing on whatever sat there. */
export function shiftKeysAt<T>(
	keys: Keyframe<T>[],
	times: readonly number[],
	delta: number,
): Keyframe<T>[] {
	const moving = keys.filter((k) => hasTime(times, k.t));
	if (moving.length === 0 || delta === 0) return keys;
	let out = keys.filter((k) => !hasTime(times, k.t));
	for (const k of moving) {
		out = putKeyframe(out, k.t + delta, k.v);
		if (k.ease) keyframeAt(out, Math.max(0, k.t + delta))!.ease = k.ease;
	}
	return out;
}

export function removeKeysAtTimes<T>(
	keys: Keyframe<T>[],
	times: readonly number[],
): Keyframe<T>[] {
	return keys.filter((k) => !hasTime(times, k.t));
}

export function setEaseAtTimes<T>(
	keys: Keyframe<T>[],
	times: readonly number[],
	ease: KeyEase | undefined,
): Keyframe<T>[] {
	return times.reduce((out, t) => setEaseAt(out, t, ease), keys);
}

/** Linear keys that sit within `tolerance` of the line through their neighbours,
 * dropped. Keys with an ease of their own stay, as do the two ends of each run. */
export function simplifyKeys(
	keys: Keyframe<number>[],
	tolerance: number,
): Keyframe<number>[] {
	if (keys.length < 3) return keys;
	const keep = new Uint8Array(keys.length);
	keep[0] = 1;
	keep[keys.length - 1] = 1;
	keys.forEach((k, i) => {
		if (k.ease || (i > 0 && keys[i - 1].ease)) keep[i] = 1;
	});
	// Douglas-Peucker on value error, over each stretch between kept keys. A stack,
	// so a long take can't run out of call depth.
	const stack: [number, number][] = [];
	let from = 0;
	for (let i = 1; i < keys.length; i++) {
		if (!keep[i]) continue;
		stack.push([from, i]);
		from = i;
	}
	while (stack.length > 0) {
		const [a, b] = stack.pop()!;
		if (b - a < 2) continue;
		const ka = keys[a];
		const kb = keys[b];
		const span = kb.t - ka.t;
		let worst = -1;
		let worstErr = tolerance;
		for (let i = a + 1; i < b; i++) {
			const k = span > 0 ? (keys[i].t - ka.t) / span : 0;
			const err = Math.abs(keys[i].v - lerp(ka.v, kb.v, k));
			if (err > worstErr) {
				worstErr = err;
				worst = i;
			}
		}
		if (worst < 0) continue;
		keep[worst] = 1;
		stack.push([a, worst], [worst, b]);
	}
	return keys.filter((_, i) => keep[i]);
}

/** A recorded pass written over `base`: the keys inside the stretch it covered go,
 * its samples come in. With `tolerance`, the samples are thinned first. */
export function writeTake(
	base: Keyframe<number>[] | undefined,
	samples: Keyframe<number>[],
	tolerance?: number,
): Keyframe<number>[] {
	if (samples.length === 0) return base ?? [];
	const from = samples[0].t;
	const to = samples[samples.length - 1].t;
	const kept = (base ?? []).filter(
		(k) => k.t < from - SAME_MOMENT || k.t > to + SAME_MOMENT,
	);
	const take =
		tolerance === undefined ? samples : simplifyKeys(samples, tolerance);
	return [...kept, ...take].sort((a, b) => a.t - b.t);
}
