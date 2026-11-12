/** Keyframes on an effect's sliders. Key times are seconds from the start of the clip
 * that holds the chain, so a clip carries its animation wherever it goes. */

import {
	easeAtIn,
	KEY_NEAR,
	keyNear,
	keyTimesOf,
	normalizeTrack,
	putKeyframe,
	removeKeyframe,
	repeatKeys,
	sampleNumbers,
	removeKeysAtTimes,
	setEaseAtTimes,
	shiftKeys,
	shiftKeysAt,
	simplifyKeys,
	type KeyEase,
	type Keyframe,
} from "../keyframes";
import { getDefinition } from "./hydrate";
import {
	linkValue,
	linkValueAt,
	normalizeKeyLink,
	type KeyLink,
} from "../key-groups";
import type { EffectInstance, ParamKeys, RangeParam } from "./types";

/** More keys than any hand-built track; a save listing more is damaged. */
const MAX_KEYS_PER_PARAM = 1000;

export function isKeyed(effect: EffectInstance, paramKey: string): boolean {
	return (effect.keys?.[paramKey]?.length ?? 0) > 0;
}

export function hasParamKeys(effect: EffectInstance): boolean {
	return (
		(!!effect.keys && Object.keys(effect.keys).length > 0) ||
		(!!effect.keyLinks && Object.keys(effect.keyLinks).length > 0)
	);
}

export function isGrouped(effect: EffectInstance, paramKey: string): boolean {
	return !!effect.keyLinks?.[paramKey];
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
	const link = effect.keyLinks?.[paramKey];
	if (link && time != null) {
		const param = rangeParam(effect.defId, paramKey);
		const v = param && linkValueAt(link, time, param);
		if (v != null) return v;
	}
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

/** The effect with `link` as the param's group link, or without one for null. */
export function setKeyLink(
	effect: EffectInstance,
	paramKey: string,
	link: KeyLink | null,
): EffectInstance {
	const next = { ...effect.keyLinks };
	if (link) next[paramKey] = link;
	else delete next[paramKey];
	const { keyLinks: _, ...rest } = effect;
	return Object.keys(next).length > 0 ? { ...rest, keyLinks: next } : rest;
}

/** The effect with `keys` as the param's whole track; empty stops it animating. */
export function setParamTrack(
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
		...setParamTrack(effect, paramKey, keys),
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
		...setParamTrack(effect, paramKey, left),
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
		...setParamTrack(effect, paramKey, null),
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

function tracksOf(effects: EffectInstance[]): Keyframe<number>[][] {
	return effects.flatMap((e) => [
		...Object.values(e.keys ?? {}),
		...Object.values(e.keyLinks ?? {}).map((l) => l.keys),
	]);
}

/** Every moment the chain has a key, sorted, with the keys that sit there merged. */
export function chainKeyTimes(effects: EffectInstance[]): number[] {
	return keyTimesOf(tracksOf(effects));
}

/** The ease the keys at `time` share, or undefined when they differ or are linear. */
export function chainEaseAt(
	effects: EffectInstance[],
	time: number,
): KeyEase | "mixed" | undefined {
	return easeAtIn(tracksOf(effects), time);
}

/** Each effect's keys rewritten by `map`; effects without keys stay as they are. */
function mapKeys(
	effects: EffectInstance[],
	map: (keys: Keyframe<number>[]) => Keyframe<number>[],
): EffectInstance[] {
	return effects.map((e) => {
		if (!hasParamKeys(e)) return e;
		let next: EffectInstance = e;
		for (const [param, link] of Object.entries(e.keyLinks ?? {})) {
			const mapped = map(link.keys);
			const range = rangeParam(e.defId, param);
			next = setKeyLink(
				next,
				param,
				mapped.length > 0 ? { ...link, keys: mapped } : null,
			);
			// A curve emptied lets the setting go, at the value it started on.
			if (mapped.length === 0 && link.keys.length > 0 && range)
				next = {
					...next,
					values: {
						...next.values,
						[param]: linkValue(link, link.keys[0].v, range),
					},
				};
		}
		for (const [param, keys] of Object.entries(e.keys ?? {})) {
			const mapped = map(keys);
			next = setParamTrack(next, param, mapped);
			// A track emptied holds the value it started on.
			if (mapped.length === 0 && keys.length > 0)
				next = { ...next, values: { ...next.values, [param]: keys[0].v } };
		}
		return next;
	});
}

/** Every key moved by `delta` seconds: a clip whose start moved under its content. */
export function shiftChainKeys(
	effects: EffectInstance[],
	delta: number,
): EffectInstance[] {
	if (delta === 0 || !chainHasKeys(effects)) return effects;
	return mapKeys(effects, (keys) => shiftKeys(keys, delta));
}

/** The keys at `times` moved by `delta`, landing on whatever sat there. */
export function moveChainKeys(
	effects: EffectInstance[],
	times: readonly number[],
	delta: number,
): EffectInstance[] {
	return mapKeys(effects, (keys) => shiftKeysAt(keys, times, delta));
}

export function removeChainKeysAt(
	effects: EffectInstance[],
	times: readonly number[],
): EffectInstance[] {
	return mapKeys(effects, (keys) => removeKeysAtTimes(keys, times));
}

export function clearChainKeys(effects: EffectInstance[]): EffectInstance[] {
	return mapKeys(effects, () => []);
}

export function setChainEaseAt(
	effects: EffectInstance[],
	times: readonly number[],
	ease: KeyEase | undefined,
): EffectInstance[] {
	return mapKeys(effects, (keys) => setEaseAtTimes(keys, times, ease));
}

/** Keys that add nothing to the motion, dropped: within 1% of each slider. */
export function simplifyChainKeys(effects: EffectInstance[]): EffectInstance[] {
	return effects.map((e) => {
		if (!hasParamKeys(e)) return e;
		let next = e;
		for (const [param, link] of Object.entries(e.keyLinks ?? {}))
			next = setKeyLink(next, param, {
				...link,
				keys: simplifyKeys(link.keys, 0.01),
			});
		for (const [param, keys] of Object.entries(e.keys ?? {}))
			next = setParamTrack(
				next,
				param,
				simplifyKeys(keys, paramTolerance(e.defId, param)),
			);
		return next;
	});
}

/** The keys from the chain's first to its last played again and again up to `length`. */
export function repeatChainKeys(
	effects: EffectInstance[],
	length: number,
): EffectInstance[] {
	const times = chainKeyTimes(effects);
	if (times.length < 2) return effects;
	const first = times[0];
	const span = times[times.length - 1] - first;
	return mapKeys(effects, (keys) => repeatKeys(keys, first, span, length));
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
		if (!hasParamKeys(e)) return e;
		const values = { ...e.values };
		for (const [param, keys] of Object.entries(e.keys ?? {})) {
			const v = sampleNumbers(keys, time);
			if (v !== null) values[param] = onStep(e.defId, param, v);
		}
		for (const [param, link] of Object.entries(e.keyLinks ?? {})) {
			const range = rangeParam(e.defId, param);
			const v = range && linkValueAt(link, time, range);
			if (v != null) values[param] = v;
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

/** How far a recorded pass may stray from its keys once thinned: 1% of the slider. */
export function paramTolerance(defId: string, paramKey: string): number {
	const param = rangeParam(defId, paramKey);
	return param ? (param.max - param.min) * 0.01 : 0.01;
}

/** Group links survive only on params that are still sliders. */
export function hydrateKeyLinks(
	defId: string,
	raw: unknown,
): Record<string, KeyLink> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const kept: Record<string, KeyLink> = {};
	for (const [key, link] of Object.entries(raw as Record<string, unknown>)) {
		const param = rangeParam(defId, key);
		const read = param && normalizeKeyLink(link, param);
		if (read) kept[key] = read;
	}
	return Object.keys(kept).length > 0 ? kept : undefined;
}

export function copyKeyLinks(
	links: Record<string, KeyLink>,
): Record<string, KeyLink> {
	return Object.fromEntries(
		Object.entries(links).map(([k, l]) => [
			k,
			{ ...l, keys: l.keys.map((key) => ({ ...key })) },
		]),
	);
}
