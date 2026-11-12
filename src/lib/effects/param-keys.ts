/** Keyframes on an effect's sliders. Key times are seconds from the start of the clip
 * that holds the chain, so a clip carries its animation wherever it goes. */

import {
	keyframeAt,
	KEY_NEAR,
	keyNear,
	normalizeTrack,
	putKeyframe,
	removeKeyframe,
	sampleNumbers,
	type KeyEase,
	type Keyframe,
} from "../keyframes";
import { getDefinition } from "./hydrate";
import type { EffectInstance, ParamKeys, RangeParam } from "./types";

/** More keys than any hand-built track; a save listing more is damaged. */
const MAX_KEYS_PER_PARAM = 1000;

/** Keys this close count as one moment on the timeline. */
const SAME_MOMENT = 1e-3;

export function isKeyed(effect: EffectInstance, paramKey: string): boolean {
	return (effect.keys?.[paramKey]?.length ?? 0) > 0;
}

export function hasParamKeys(effect: EffectInstance): boolean {
	return !!effect.keys && Object.keys(effect.keys).length > 0;
}

export function chainHasKeys(effects: EffectInstance[]): boolean {
	return effects.some(hasParamKeys);
}

/** What a param reads at `time`: its keys when it has any, else its stored value. */
export function paramValueAt(
	effect: EffectInstance,
	paramKey: string,
	time: number | null | undefined,
): number | string {
	const keys = effect.keys?.[paramKey];
	if (time == null || !keys?.length) return effect.values[paramKey];
	const v = sampleNumbers(keys, time);
	return v === null
		? effect.values[paramKey]
		: onStep(effect.defId, paramKey, v);
}

/** A sampled value on the slider's own grid, as an audio link lands it. */
function onStep(defId: string, paramKey: string, v: number): number {
	const param = rangeParam(defId, paramKey);
	if (!param || !(param.step > 0)) return v;
	const snapped =
		Math.round((v - param.min) / param.step) * param.step + param.min;
	return Math.max(param.min, Math.min(param.max, snapped));
}

function withKeys(
	effect: EffectInstance,
	paramKey: string,
	keys: Keyframe<number>[] | null,
): EffectInstance {
	const next: ParamKeys = { ...effect.keys };
	if (keys && keys.length > 0) next[paramKey] = keys;
	else delete next[paramKey];
	const { keys: _, ...rest } = effect;
	return Object.keys(next).length > 0 ? { ...rest, keys: next } : rest;
}

/** The effect with `value` keyed at `time`. The stored value follows, so a param
 * that stops animating keeps what it last showed. */
export function setParamKey(
	effect: EffectInstance,
	paramKey: string,
	time: number,
	value: number,
): EffectInstance {
	const keys = putKeyframe(effect.keys?.[paramKey], time, value);
	return {
		...withKeys(effect, paramKey, keys),
		values: { ...effect.values, [paramKey]: value },
	};
}

/** The key nearest `time`, within the playhead's reach, gone. The last one going
 * leaves the param still, at the value it had there. */
export function removeParamKey(
	effect: EffectInstance,
	paramKey: string,
	time: number,
): EffectInstance {
	const keys = effect.keys?.[paramKey];
	const hit = keyNear(keys, time);
	if (!hit) return effect;
	const left = removeKeyframe(keys, hit.t);
	const value = left.length > 0 ? effect.values[paramKey] : hit.v;
	return {
		...withKeys(effect, paramKey, left),
		values: { ...effect.values, [paramKey]: value },
	};
}

/** The param stops animating and holds the value it shows at `time`. */
export function clearParamKeys(
	effect: EffectInstance,
	paramKey: string,
	time: number,
): EffectInstance {
	const value = paramValueAt(effect, paramKey, time);
	return {
		...withKeys(effect, paramKey, null),
		values: { ...effect.values, [paramKey]: value },
	};
}

export function keyAtTime(
	effect: EffectInstance,
	paramKey: string,
	time: number,
): Keyframe<number> | null {
	return keyNear(effect.keys?.[paramKey], time);
}

/** The nearest key time before or after `time` across one param, or null. */
export function adjacentKeyTime(
	keys: Keyframe<number>[] | undefined,
	time: number,
	direction: -1 | 1,
): number | null {
	let best: number | null = null;
	for (const k of keys ?? []) {
		const ahead = direction > 0 ? k.t > time + KEY_NEAR : k.t < time - KEY_NEAR;
		if (!ahead) continue;
		if (best === null || (direction > 0 ? k.t < best : k.t > best)) best = k.t;
	}
	return best;
}

/** Every moment the chain has a key, sorted, with the keys that sit there merged. */
export function chainKeyTimes(effects: EffectInstance[]): number[] {
	const times: number[] = [];
	for (const e of effects)
		for (const keys of Object.values(e.keys ?? {}))
			for (const k of keys) times.push(k.t);
	times.sort((a, b) => a - b);
	const out: number[] = [];
	for (const t of times)
		if (out.length === 0 || t - out[out.length - 1] > SAME_MOMENT) out.push(t);
	return out;
}

/** The ease the keys at `time` share, or undefined when they differ or are linear. */
export function chainEaseAt(
	effects: EffectInstance[],
	time: number,
): KeyEase | "mixed" | undefined {
	let ease: KeyEase | undefined | null = null;
	for (const e of effects)
		for (const keys of Object.values(e.keys ?? {})) {
			const k = keyframeAt(keys, time);
			if (!k) continue;
			if (ease === null) ease = k.ease;
			else if (ease !== k.ease) return "mixed";
		}
	return ease ?? undefined;
}

/** Each effect's keys rewritten by `map`; effects without keys stay as they are. */
function mapKeys(
	effects: EffectInstance[],
	map: (keys: Keyframe<number>[]) => Keyframe<number>[],
): EffectInstance[] {
	return effects.map((e) => {
		if (!e.keys) return e;
		let next: EffectInstance = e;
		for (const [param, keys] of Object.entries(e.keys))
			next = withKeys(next, param, map(keys));
		return next;
	});
}

/** Every key moved by `delta` seconds: a clip whose start moved under its content. */
export function shiftChainKeys(
	effects: EffectInstance[],
	delta: number,
): EffectInstance[] {
	if (delta === 0 || !chainHasKeys(effects)) return effects;
	return mapKeys(effects, (keys) =>
		keys.map((k) => ({ ...k, t: k.t + delta })),
	);
}

/** Every key at `from` moved to `to`, landing on whatever sat there. */
export function moveChainKeys(
	effects: EffectInstance[],
	from: number,
	to: number,
): EffectInstance[] {
	return mapKeys(effects, (keys) => {
		const k = keyframeAt(keys, from);
		if (!k) return keys;
		const rest = removeKeyframe(keys, k.t);
		const moved = putKeyframe(rest, to, k.v);
		if (k.ease) keyframeAt(moved, Math.max(0, to))!.ease = k.ease;
		return moved;
	});
}

export function removeChainKeysAt(
	effects: EffectInstance[],
	time: number,
): EffectInstance[] {
	return mapKeys(effects, (keys) => removeKeyframe(keys, time));
}

export function setChainEaseAt(
	effects: EffectInstance[],
	time: number,
	ease: KeyEase | undefined,
): EffectInstance[] {
	return mapKeys(effects, (keys) =>
		keys.map((k) => {
			if (Math.abs(k.t - time) > SAME_MOMENT) return k;
			const { ease: _, ...plain } = k;
			return ease ? { ...plain, ease } : plain;
		}),
	);
}

/** Every key gone from the effects a roll replaces. */
export function dropParamKeys(effect: EffectInstance): void {
	delete effect.keys;
}

/** The chain as it stands `time` seconds into its clip. A chain without keys comes
 * back as is; one with keys as copies holding the sampled values, the same
 * instance ids kept so the renderer's per-effect state carries on. */
export function chainAtKeyTime(
	effects: EffectInstance[],
	time: number,
): EffectInstance[] {
	if (!chainHasKeys(effects)) return effects;
	return effects.map((e) => {
		if (!e.keys) return e;
		const values = { ...e.values };
		for (const [param, keys] of Object.entries(e.keys)) {
			const v = sampleNumbers(keys, time);
			if (v !== null) values[param] = onStep(e.defId, param, v);
		}
		return { ...e, values };
	});
}

function rangeParam(defId: string, key: string): RangeParam | null {
	const param = getDefinition(defId)?.params.find((p) => p.key === key);
	return param?.type === "range" ? param : null;
}

/** Keys survive only on params that are still sliders, held to their range. */
export function hydrateParamKeys(
	defId: string,
	raw: unknown,
): ParamKeys | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const kept: ParamKeys = {};
	for (const [key, track] of Object.entries(raw as Record<string, unknown>)) {
		const param = rangeParam(defId, key);
		if (!param) continue;
		const keys = normalizeTrack(
			track,
			(v) =>
				typeof v === "number" && Number.isFinite(v)
					? Math.min(param.max, Math.max(param.min, v))
					: param.defaultValue,
			MAX_KEYS_PER_PARAM,
		);
		if (keys) kept[key] = keys;
	}
	return Object.keys(kept).length > 0 ? kept : undefined;
}

export function copyParamKeys(keys: ParamKeys): ParamKeys {
	return Object.fromEntries(
		Object.entries(keys).map(([k, track]) => [
			k,
			track.map((key) => ({ ...key })),
		]),
	);
}
