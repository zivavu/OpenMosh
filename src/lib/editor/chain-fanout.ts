/** One clip's chain edit, carried to the other selected clips that run the same effects. */

import {
	cloneEffectInstance,
	type EffectInstance,
	type VolumeLink,
} from "../effects";
import type { ChainClip } from "./chain-clip";
import { handBuiltLabel, isHandBuiltLabel } from "./sequence";

export type ChainFields = Pick<
	ChainClip,
	"effects" | "label" | "presetName" | "modified"
>;

/** The effects a chain switches on, in order. */
function liveSignature(effects: EffectInstance[]): string {
	return effects
		.filter((e) => e.enabled)
		.map((e) => e.defId)
		.join(",");
}

/** True when every chain switches on the same effects in the same order. */
export function sameLiveChain(chains: EffectInstance[][]): boolean {
	const [first, ...rest] = chains.map(liveSignature);
	return rest.every((s) => s === first);
}

/** The effect's id plus which copy of it, so a duplicate matches its twin. */
function slotKeys(chain: EffectInstance[]): string[] {
	const seen = new Map<string, number>();
	return chain.map((e) => {
		const n = seen.get(e.defId) ?? 0;
		seen.set(e.defId, n + 1);
		return `${e.defId}#${n}`;
	});
}

function sameLink(a?: VolumeLink, b?: VolumeLink): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** `target` with only the fields that changed from `before` to `after`. */
function applyChanges(
	before: EffectInstance,
	after: EffectInstance,
	target: EffectInstance,
): EffectInstance {
	const values = { ...target.values };
	for (const [k, v] of Object.entries(after.values)) {
		if (before.values[k] !== v) values[k] = v;
	}
	const links = { ...target.volumeLinks };
	const linkKeys = new Set([
		...Object.keys(before.volumeLinks ?? {}),
		...Object.keys(after.volumeLinks ?? {}),
	]);
	for (const k of linkKeys) {
		const link = after.volumeLinks?.[k];
		if (sameLink(before.volumeLinks?.[k], link)) continue;
		if (link) links[k] = { ...link };
		else delete links[k];
	}
	return {
		...target,
		enabled: after.enabled !== before.enabled ? after.enabled : target.enabled,
		locked: after.locked !== before.locked ? after.locked : target.locked,
		values,
		volumeLinks: Object.keys(links).length > 0 ? links : undefined,
	};
}

/** Replays the edit that turned `before` into `after` on `target`: changed fields
 * only, so the target keeps its own values. It takes the edited chain's order;
 * effects the edited chain never had stay, at the end. */
export function fanOutChainEdit(
	before: EffectInstance[],
	after: EffectInstance[],
	target: EffectInstance[],
): EffectInstance[] {
	const beforeKeys = slotKeys(before);
	const beforeById = new Map(
		before.map((e, i) => [e.instanceId, { effect: e, key: beforeKeys[i] }]),
	);
	const targetKeys = slotKeys(target);
	const targetBySlot = new Map(target.map((e, i) => [targetKeys[i], e]));
	const edited = after.map((a) => {
		const was = beforeById.get(a.instanceId);
		const own = was && targetBySlot.get(was.key);
		return own ? applyChanges(was.effect, a, own) : cloneEffectInstance(a);
	});
	const known = new Set(beforeKeys);
	const extra = target.filter((_, i) => !known.has(targetKeys[i]));
	return [...edited, ...extra];
}

/** `fanOutChainEdit` for a whole clip. Label fields the edit changed are copied;
 * the rest stay the target's own, so another preset keeps its name. */
export function fanOutClipEdit<C extends ChainClip>(
	before: ChainFields,
	after: ChainFields,
	target: C,
): C {
	const effects = fanOutChainEdit(
		before.effects,
		after.effects,
		target.effects,
	);
	const next: C = { ...target, effects };
	if (after.presetName !== before.presetName)
		next.presetName = after.presetName;
	if (after.modified !== before.modified) next.modified = after.modified;
	else if (after.modified && next.presetName) next.modified = true;
	if (after.label !== before.label) next.label = after.label;
	else if (isHandBuiltLabel(next)) next.label = handBuiltLabel(effects);
	return next;
}

function isChainEdit(before: ChainFields, after: ChainFields): boolean {
	return (
		after.effects !== before.effects ||
		after.label !== before.label ||
		after.presetName !== before.presetName ||
		after.modified !== before.modified
	);
}

/** The other selected clips, edited alongside `after`: none unless every one ran
 * the same effects as `before`. */
export function fanOutEdit<C extends ChainClip>(
	before: C | null | undefined,
	after: ChainFields,
	others: C[],
): C[] {
	if (!before || others.length === 0 || !isChainEdit(before, after)) return [];
	if (!sameLiveChain([before.effects, ...others.map((c) => c.effects)]))
		return [];
	return others.map((c) => fanOutClipEdit(before, after, c));
}

/** What the chain panel says about a multi-selection; null for a single clip. */
export function fanOutNote(
	clip: ChainClip | null,
	others: ChainClip[],
): string | null {
	if (!clip || others.length === 0) return null;
	return sameLiveChain([clip.effects, ...others.map((c) => c.effects)])
		? `Edits here change all ${others.length + 1} selected clips.`
		: "The selected clips run different effects, so edits here only change this one.";
}
