/** A chain's sliders as groupable slots (see key-groups.ts), and the panel's group
 * edits on them. Groups span the effects of one chain. */

import {
	groupNames,
	joinGroup,
	keyGroupAt,
	leaveGroup,
	setGroupCurve,
	setLinkRange,
	toggleGroupKey,
	type KeyLink,
	type Slot,
	type SlotPatches,
} from "../key-groups";
import type { Keyframe } from "../keyframes";
import { getDefinition } from "./hydrate";
import { setKeyLink, setParamTrack } from "./param-keys";
import type { EffectInstance } from "./types";

export function paramSlotId(instanceId: string, param: string): string {
	return `${instanceId}:${param}`;
}

export function paramSlot(effect: EffectInstance, param: string): Slot | null {
	const def = getDefinition(effect.defId)?.params.find((p) => p.key === param);
	if (def?.type !== "range") return null;
	return {
		id: paramSlotId(effect.instanceId, param),
		keys: effect.keys?.[param],
		link: effect.keyLinks?.[param],
		value: Number(effect.values[param]),
		min: def.min,
		max: def.max,
		step: def.step,
	};
}

/** Every slider in the chain that is keyed or grouped. */
export function chainSlots(effects: EffectInstance[]): Slot[] {
	const slots: Slot[] = [];
	for (const e of effects)
		for (const param of new Set([
			...Object.keys(e.keys ?? {}),
			...Object.keys(e.keyLinks ?? {}),
		])) {
			const slot = paramSlot(e, param);
			if (slot) slots.push(slot);
		}
	return slots;
}

export function chainGroupNames(effects: EffectInstance[]): string[] {
	return groupNames(chainSlots(effects));
}

export function applyChainPatches(
	effects: EffectInstance[],
	patches: SlotPatches,
): EffectInstance[] {
	if (patches.size === 0) return effects;
	return effects.map((e) => {
		let next = e;
		for (const [id, patch] of patches) {
			if (!id.startsWith(`${e.instanceId}:`)) continue;
			const param = id.slice(e.instanceId.length + 1);
			if (patch.keys !== undefined)
				next = setParamTrack(next, param, patch.keys ?? []);
			if (patch.link !== undefined) next = setKeyLink(next, param, patch.link);
			if (patch.value !== undefined)
				next = { ...next, values: { ...next.values, [param]: patch.value } };
		}
		return next;
	});
}

/** Run `edit` on one slider's slot and write what it changes back to the chain. */
function onSlot(
	effects: EffectInstance[],
	index: number,
	param: string,
	edit: (slots: Slot[], slot: Slot) => SlotPatches,
): EffectInstance[] {
	const effect = effects[index];
	const slot = effect && paramSlot(effect, param);
	if (!slot) return effects;
	const slots = chainSlots(effects);
	return applyChainPatches(effects, edit(slots, slot));
}

/** The slider joins `group`, or a new one when null. It stops following the music. */
export function groupParam(
	effects: EffectInstance[],
	index: number,
	param: string,
	group: string | null,
	time: number,
): EffectInstance[] {
	const next = onSlot(effects, index, param, (slots, slot) =>
		joinGroup(slots, slot, group, time),
	);
	const e = next[index];
	if (!e?.volumeLinks?.[param]) return next;
	const { [param]: _, ...links } = e.volumeLinks;
	return next.map((x, i) =>
		i === index
			? { ...x, volumeLinks: Object.keys(links).length > 0 ? links : undefined }
			: x,
	);
}

export function ungroupParam(
	effects: EffectInstance[],
	index: number,
	param: string,
): EffectInstance[] {
	return onSlot(effects, index, param, (_, slot) => leaveGroup(slot));
}

export function setParamGroupRange(
	effects: EffectInstance[],
	index: number,
	param: string,
	range: Partial<Pick<KeyLink, "min" | "max" | "inverted">>,
): EffectInstance[] {
	return onSlot(effects, index, param, (_, slot) => setLinkRange(slot, range));
}

export function toggleGroupedKey(
	effects: EffectInstance[],
	index: number,
	param: string,
	time: number,
	clear: boolean,
): EffectInstance[] {
	return onSlot(effects, index, param, (slots, slot) =>
		toggleGroupKey(slots, slot, time, clear),
	);
}

/** A grouped slider moved: the group's curve gets a key where it puts that value. */
export function keyGroupedValue(
	effects: EffectInstance[],
	index: number,
	param: string,
	time: number,
	value: number,
): EffectInstance[] {
	return onSlot(effects, index, param, (slots, slot) =>
		keyGroupAt(slots, slot, time, value),
	);
}

export function setChainGroupCurve(
	effects: EffectInstance[],
	group: string,
	keys: Keyframe<number>[],
): EffectInstance[] {
	return applyChainPatches(
		effects,
		setGroupCurve(chainSlots(effects), group, keys),
	);
}
