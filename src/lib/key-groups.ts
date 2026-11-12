/** Settings grouped to follow one keyed curve. The group's curve runs 0..1, and each
 * member turns it into its own range, as an audio link does with the music. Every
 * member carries the curve, so a chain stays whole wherever it is copied; edits
 * write it to all of them at once. */

import {
	keyNear,
	normalizeTrack,
	putKeyframe,
	removeKeyframe,
	sampleNumbers,
	type Keyframe,
} from "./keyframes";

export interface KeyLink {
	/** "A", "B", …: unique among the groups of one chain or one layer. */
	group: string;
	/** The value the curve's 0 and 1 land on. */
	min: number;
	max: number;
	inverted?: boolean;
	/** The group's curve, 0..1. */
	keys: Keyframe<number>[];
}

/** One setting that can be grouped: a slider or a layer's placement value. */
export interface Slot {
	id: string;
	keys?: Keyframe<number>[];
	link?: KeyLink;
	/** The value it holds when nothing animates it. */
	value: number;
	min: number;
	max: number;
	step: number;
}

/** What changes on a slot. `null` takes a field away. */
export interface SlotPatch {
	keys?: Keyframe<number>[] | null;
	link?: KeyLink | null;
	value?: number;
}

export type SlotPatches = Map<string, SlotPatch>;

function onStep(slot: Pick<Slot, "min" | "max" | "step">, v: number): number {
	const snapped =
		slot.step > 0
			? Math.round((v - slot.min) / slot.step) * slot.step + slot.min
			: v;
	// Rounded past float noise, so a step of 0.005 stores 0.2 rather than 0.20000000000000007.
	return (
		Math.round(Math.min(slot.max, Math.max(slot.min, snapped)) * 1e9) / 1e9
	);
}

/** Where the curve sits for `value`, in the member's range. */
export function levelOf(link: KeyLink, value: number): number {
	const span = link.max - link.min;
	const level = span !== 0 ? (value - link.min) / span : 0;
	const clamped = Math.min(1, Math.max(0, level));
	return link.inverted ? 1 - clamped : clamped;
}

/** The member's value for a curve `level`. */
export function linkValue(
	link: KeyLink,
	level: number,
	slot: Pick<Slot, "min" | "max" | "step">,
): number {
	const l = link.inverted ? 1 - level : level;
	return onStep(slot, link.min + l * (link.max - link.min));
}

/** The member's value at `time`, or null for a group with no keys. */
export function linkValueAt(
	link: KeyLink,
	time: number,
	slot: Pick<Slot, "min" | "max" | "step">,
): number | null {
	const level = sampleNumbers(link.keys, time);
	return level === null ? null : linkValue(link, level, slot);
}

/** The groups among `slots`, in name order. */
export function groupNames(slots: Slot[]): string[] {
	return [
		...new Set(slots.flatMap((s) => (s.link ? [s.link.group] : []))),
	].sort();
}

function members(slots: Slot[], group: string): Slot[] {
	return slots.filter((s) => s.link?.group === group);
}

/** The first letter no group goes by yet. */
export function nextGroupName(slots: Slot[]): string {
	const taken = new Set(groupNames(slots));
	for (let i = 0; i < 26 * 27; i++) {
		const name =
			i < 26
				? String.fromCharCode(65 + i)
				: String.fromCharCode(64 + Math.floor(i / 26)) +
					String.fromCharCode(65 + (i % 26));
		if (!taken.has(name)) return name;
	}
	return `G${taken.size}`;
}

/** The range a setting joins with: what its own keys span, else its whole slider. */
function joiningRange(slot: Slot): { min: number; max: number } {
	const values = slot.keys?.map((k) => k.v) ?? [];
	const lo = Math.min(...values);
	const hi = Math.max(...values);
	return values.length > 1 && hi > lo
		? { min: lo, max: hi }
		: { min: slot.min, max: slot.max };
}

/** The setting's value shown at `time`: its group's, its own keys', or its value. */
export function slotValueAt(slot: Slot, time: number): number {
	if (slot.link) return linkValueAt(slot.link, time, slot) ?? slot.value;
	return sampleNumbers(slot.keys, time) ?? slot.value;
}

/** `slot` joins `group`, or a new group when null. A new group takes the setting's
 * own motion as its curve; joining one that exists takes the group's. */
export function joinGroup(
	slots: Slot[],
	slot: Slot,
	group: string | null,
	time: number,
): SlotPatches {
	const range = joiningRange(slot);
	if (group === null) {
		const shown = slotValueAt(slot, time);
		const link: KeyLink = { group: nextGroupName(slots), ...range, keys: [] };
		link.keys = slot.keys?.length
			? slot.keys.map((k) => ({ ...k, v: levelOf(link, k.v) }))
			: [{ t: Math.max(0, time), v: levelOf(link, shown) }];
		return new Map([[slot.id, { link, keys: null }]]);
	}
	const curve = members(slots, group)[0]?.link?.keys ?? [];
	return new Map([
		[
			slot.id,
			{
				link: { group, ...range, keys: curve.map((k) => ({ ...k })) },
				keys: null,
			},
		],
	]);
}

/** `slot` leaves its group and keeps its motion as keys of its own. */
export function leaveGroup(slot: Slot): SlotPatches {
	const link = slot.link;
	if (!link) return new Map();
	const keys = link.keys.map((k) => ({ ...k, v: linkValue(link, k.v, slot) }));
	return new Map([
		[slot.id, keys.length > 0 ? { link: null, keys } : { link: null }],
	]);
}

/** Every member of `group` handed `keys` as its curve. A curve emptied ends the
 * group: each member holds the value it showed at `time`. */
export function setGroupCurve(
	slots: Slot[],
	group: string,
	keys: Keyframe<number>[],
	time = 0,
): SlotPatches {
	const patches: SlotPatches = new Map();
	for (const slot of members(slots, group)) {
		patches.set(
			slot.id,
			keys.length > 0
				? { link: { ...slot.link!, keys: keys.map((k) => ({ ...k })) } }
				: { link: null, value: slotValueAt(slot, time) },
		);
	}
	return patches;
}

/** A member set to `value` at `time`: the group's curve gets the matching key. */
export function keyGroupAt(
	slots: Slot[],
	slot: Slot,
	time: number,
	value: number,
): SlotPatches {
	const link = slot.link!;
	return setGroupCurve(
		slots,
		link.group,
		putKeyframe(link.keys, time, levelOf(link, value)),
	);
}

/** The diamond on a grouped setting: key the curve here, take its key here away,
 * or with `clear` let this setting go, holding the value it shows. */
export function toggleGroupKey(
	slots: Slot[],
	slot: Slot,
	time: number,
	clear: boolean,
): SlotPatches {
	const link = slot.link!;
	if (clear)
		return new Map([[slot.id, { link: null, value: slotValueAt(slot, time) }]]);
	const hit = keyNear(link.keys, time);
	const keys = hit
		? removeKeyframe(link.keys, hit.t)
		: putKeyframe(link.keys, time, sampleNumbers(link.keys, time) ?? 0);
	return setGroupCurve(slots, link.group, keys, time);
}

export function setLinkRange(
	slot: Slot,
	range: Partial<Pick<KeyLink, "min" | "max" | "inverted">>,
): SlotPatches {
	const link = { ...slot.link!, ...range };
	if (!link.inverted) delete link.inverted;
	return new Map([[slot.id, { link }]]);
}

/** A stored link, or undefined when it can't be read. Values held to the slider. */
export function normalizeKeyLink(
	raw: unknown,
	slot: Pick<Slot, "min" | "max">,
): KeyLink | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Partial<KeyLink>;
	if (typeof r.group !== "string" || !/^[A-Z]{1,2}$/.test(r.group))
		return undefined;
	const clamp = (n: unknown, fallback: number) =>
		typeof n === "number" && Number.isFinite(n)
			? Math.min(slot.max, Math.max(slot.min, n))
			: fallback;
	const keys = normalizeTrack(r.keys, (v) =>
		typeof v === "number" && Number.isFinite(v)
			? Math.min(1, Math.max(0, v))
			: 0,
	);
	if (!keys) return undefined;
	return {
		group: r.group,
		min: clamp(r.min, slot.min),
		max: clamp(r.max, slot.max),
		...(r.inverted === true && { inverted: true }),
		keys,
	};
}
