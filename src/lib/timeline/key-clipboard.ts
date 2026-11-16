/** Copied keys, pasted at the playhead onto the selected clip. An effect's keys find
 * their slider by the effect's kind and its place among that kind in the chain, so
 * they paste onto another clip with the same effects too. */

import { latestCopy, markCopied } from "../editor/copy-stamp";
import {
	keyframeAt,
	putKeyframe,
	SAME_MOMENT,
	type KeyEase,
	type Keyframe,
} from "../keyframes";
import { getDefinition } from "../effects/hydrate";
import { setChainGroupCurve } from "../effects/param-groups";
import { setParamTrack } from "../effects/param-keys";
import type { EffectInstance } from "../effects/types";
import {
	isPlacementGrouped,
	PLACEMENT_KEYS,
	setLaneGroupCurve,
	setLaneTrack,
	type PlacementKey,
} from "../media/lane-keys";
import type { MediaLane } from "../media/types";
import type { KeyRef, KeyRow } from "./key-rows";
import { clipKeyTime } from "../effects/param-keys";
import { showToast } from "../components/ui/toast.svelte";

export type KeyTarget =
	| { kind: "fx"; defId: string; nth: number; param: string }
	| { kind: "fxgroup"; group: string }
	| { kind: "lane"; key: PlacementKey }
	| { kind: "lanegroup"; group: string };

/** One key as copied, `t` in timeline seconds; the clipboard counts from the first. */
export interface CopiedKey {
	target: KeyTarget;
	t: number;
	v: number;
	ease?: KeyEase;
}

let board: { keys: CopiedKey[]; stamp: number } | null = null;

export function copyKeys(keys: CopiedKey[]): boolean {
	if (keys.length === 0) return false;
	const first = Math.min(...keys.map((k) => k.t));
	board = {
		keys: keys.map((k) => ({ ...k, t: k.t - first })),
		stamp: markCopied(),
	};
	return true;
}

/** The copied keys, while nothing else has been copied since. */
export function copiedKeys(): CopiedKey[] | null {
	return board && board.stamp === latestCopy() ? board.keys : null;
}

const near = (times: readonly number[], t: number) =>
	times.some((x) => Math.abs(x - t) <= SAME_MOMENT);

function copied(
	target: KeyTarget,
	keys: Keyframe<number>[],
	times: readonly number[],
	offset: number,
): CopiedKey[] {
	return keys
		.filter((k) => near(times, k.t))
		.map((k) => ({
			target,
			t: k.t + offset,
			v: k.v,
			...(k.ease ? { ease: k.ease } : {}),
		}));
}

/** Each effect's place among the chain's effects of its kind, from 0. */
function nths(effects: EffectInstance[]): number[] {
	const seen = new Map<string, number>();
	return effects.map((e) => {
		const n = seen.get(e.defId) ?? 0;
		seen.set(e.defId, n + 1);
		return n;
	});
}

/** The chain's keys at `times`, seconds into a clip starting at `start`. */
export function chainKeysAt(
	effects: EffectInstance[],
	times: readonly number[],
	start: number,
): CopiedKey[] {
	const n = nths(effects);
	const groups = new Set<string>();
	return effects.flatMap((e, i) => [
		...Object.entries(e.keys ?? {}).flatMap(([param, keys]) =>
			copied(
				{ kind: "fx", defId: e.defId, nth: n[i], param },
				keys,
				times,
				start,
			),
		),
		...Object.values(e.keyLinks ?? {}).flatMap((link) => {
			if (groups.has(link.group)) return [];
			groups.add(link.group);
			return copied(
				{ kind: "fxgroup", group: link.group },
				link.keys,
				times,
				start,
			);
		}),
	]);
}

/** A layer's placement keys at `times`, in timeline seconds. */
export function laneKeysAt(
	lane: MediaLane,
	times: readonly number[],
): CopiedKey[] {
	const groups = new Set<string>();
	return PLACEMENT_KEYS.flatMap((key) => {
		const link = lane.keyLinks?.[key];
		if (link) {
			if (groups.has(link.group)) return [];
			groups.add(link.group);
			return copied(
				{ kind: "lanegroup", group: link.group },
				link.keys,
				times,
				0,
			);
		}
		return copied({ kind: "lane", key }, lane.keys?.[key] ?? [], times, 0);
	});
}

/** The picked keys of setting rows, in timeline seconds. */
export function rowKeysAt(rows: KeyRow[], refs: KeyRef[]): CopiedKey[] {
	return rows.flatMap((row) => {
		const times = refs.filter((r) => r.row === row.id).map((r) => r.t);
		return row.target && times.length > 0
			? copied(row.target, row.keys, times, row.offset)
			: [];
	});
}

function put(
	keys: Keyframe<number>[] | undefined,
	k: CopiedKey,
	at: number,
): Keyframe<number>[] {
	const t = Math.max(0, at + k.t);
	const out = putKeyframe(keys, t, k.v);
	const key = keyframeAt(out, t)!;
	if (k.ease) key.ease = k.ease;
	else delete key.ease;
	return out;
}

/** The keys pasted into a chain, `at` seconds into its clip. Keys whose slider or
 * group the chain lacks stay out; `landed` counts the rest. */
export function pasteIntoChain(
	effects: EffectInstance[],
	keys: CopiedKey[],
	at: number,
): { effects: EffectInstance[]; landed: number } {
	const n = nths(effects);
	let next = effects;
	let landed = 0;
	for (const k of keys) {
		const target = k.target;
		if (target.kind === "fxgroup") {
			const curve = next
				.flatMap((e) => Object.values(e.keyLinks ?? {}))
				.find((l) => l.group === target.group)?.keys;
			if (!curve) continue;
			next = setChainGroupCurve(next, target.group, put(curve, k, at));
			landed++;
			continue;
		}
		if (target.kind !== "fx") continue;
		const i = next.findIndex(
			(e, j) => e.defId === target.defId && n[j] === target.nth,
		);
		const e = next[i];
		const param = getDefinition(target.defId)?.params.find(
			(p) => p.key === target.param,
		);
		if (!e || param?.type !== "range" || e.keyLinks?.[target.param]) continue;
		const v = Math.min(param.max, Math.max(param.min, k.v));
		const keyed = setParamTrack(
			e,
			target.param,
			put(e.keys?.[target.param], { ...k, v }, at),
		);
		next = next.map((x, j) => (j === i ? keyed : x));
		landed++;
	}
	return { effects: next, landed };
}

/** The placement keys pasted onto a layer, `at` in timeline seconds. */
export function pasteIntoLane(
	lane: MediaLane,
	keys: CopiedKey[],
	at: number,
): { lane: MediaLane; landed: number } {
	let next = lane;
	let landed = 0;
	for (const k of keys) {
		const target = k.target;
		if (target.kind === "lanegroup") {
			const curve = Object.values(next.keyLinks ?? {}).find(
				(l) => l?.group === target.group,
			)?.keys;
			if (!curve) continue;
			next = setLaneGroupCurve(next, target.group, put(curve, k, at));
			landed++;
		} else if (
			target.kind === "lane" &&
			!isPlacementGrouped(next, target.key)
		) {
			next = setLaneTrack(
				next,
				target.key,
				put(next.keys?.[target.key], k, at),
			);
			landed++;
		}
	}
	return { lane: next, landed };
}

/** The copied keys pasted at timeline `at` onto a clip, and its layer when it has
 * one. Null, with a toast saying why, when none of them land. */
export function pasteKeysOnto<
	C extends { start: number; end: number; effects: EffectInstance[] },
>(clip: C, at: number, lane?: MediaLane): { clip: C; lane?: MediaLane } | null {
	const keys = copiedKeys();
	if (!keys) return null;
	if (clipKeyTime(at, clip).outside) {
		showToast("Move the playhead into the clip to paste keys there", "info");
		return null;
	}
	const chain = pasteIntoChain(clip.effects, keys, at - clip.start);
	const layer = lane && pasteIntoLane(lane, keys, at);
	if (chain.landed + (layer?.landed ?? 0) === 0) {
		showToast("This clip has none of the settings those keys are for", "info");
		return null;
	}
	return {
		clip: chain.landed > 0 ? { ...clip, effects: chain.effects } : clip,
		...(layer && layer.landed > 0 ? { lane: layer.lane } : {}),
	};
}
