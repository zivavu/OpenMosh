/** A mosh that composes rather than scatters: effects fill slots without fighting,
 * run in signal-chain order, and one hero carries the look while the rest support it. */

import { getDefinition, type EffectInstance } from "../effects";
import { curationOf, FAMILIES, STAGES, type Family } from "../effects/curation";
import { shuffleInPlace } from "../utils";

/** How often the chain order is broken on purpose: some of the best accidents live there. */
const RULE_BREAK_CHANCE = 0.1;
/** Share of an amount param's mosh range the hero and the supports land in. */
const HERO_AMOUNT: [number, number] = [0.6, 0.9];
const SUPPORT_AMOUNT: [number, number] = [0.12, 0.4];

function familyOf(e: EffectInstance): Family {
	return curationOf(e.defId).family;
}

function stageOf(e: EffectInstance): number {
	return STAGES.indexOf(curationOf(e.defId).stage);
}

/** Up to `target` of `pool`, drawn family by family, no family past its cap. The
 * first is the hero. `taken` counts families already on in the chain. */
export function pickCurated(
	pool: EffectInstance[],
	target: number,
	taken: Map<Family, number>,
): EffectInstance[] {
	const counts = new Map(taken);
	const left = [...pool];
	const picked: EffectInstance[] = [];
	while (picked.length < target) {
		let open = left.filter(
			(e) => (counts.get(familyOf(e)) ?? 0) < FAMILIES[familyOf(e)].cap,
		);
		if (picked.length === 0) {
			const heroes = open.filter((e) => FAMILIES[familyOf(e)].hero);
			if (heroes.length > 0) open = heroes;
		}
		if (open.length === 0) break;
		const families = [...new Set(open.map(familyOf))];
		const family = weightedPick(families, (f) => FAMILIES[f].weight);
		const members = open.filter((e) => familyOf(e) === family);
		const effect = members[Math.floor(Math.random() * members.length)];
		picked.push(effect);
		left.splice(left.indexOf(effect), 1);
		counts.set(family, (counts.get(family) ?? 0) + 1);
	}
	return picked;
}

function weightedPick<T>(items: T[], weight: (item: T) => number): T {
	const total = items.reduce((sum, item) => sum + weight(item), 0);
	let r = Math.random() * total;
	for (const item of items) {
		r -= weight(item);
		if (r < 0) return item;
	}
	return items[items.length - 1];
}

/** `effects` in signal-chain order, ties shuffled; now and then one pair swaps. */
export function curatedOrder(effects: EffectInstance[]): EffectInstance[] {
	const ordered = shuffleInPlace([...effects]).sort(
		(a, b) => stageOf(a) - stageOf(b),
	);
	if (ordered.length > 1 && Math.random() < RULE_BREAK_CHANCE) {
		const i = Math.floor(Math.random() * (ordered.length - 1));
		[ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
	}
	return ordered;
}

/** Set an effect's amount param to a share of its mosh range, in place. */
export function setAmount(effect: EffectInstance, share: [number, number]) {
	const amount = curationOf(effect.defId).amount;
	const param = getDefinition(effect.defId)?.params.find(
		(p) => p.key === amount?.key,
	);
	if (!amount || param?.type !== "range") return;
	const lo = param.moshMin ?? param.min;
	const hi = param.moshMax ?? param.max;
	const t = share[0] + Math.random() * (share[1] - share[0]);
	let value: number;
	if (amount.centered) {
		const reach = Math.max(Math.abs(lo), Math.abs(hi)) * t;
		value =
			Math.random() < 0.5 && lo < 0
				? Math.max(lo, -reach)
				: Math.min(hi, reach);
	} else {
		value = lo + t * (hi - lo);
	}
	effect.values[param.key] =
		param.step > 0
			? Math.round((value - param.min) / param.step) * param.step + param.min
			: value;
}

/** The hero pushed hard, the rest held back. */
export function applyHierarchy(picked: EffectInstance[]) {
	picked.forEach((e, i) =>
		setAmount(e, i === 0 ? HERO_AMOUNT : SUPPORT_AMOUNT),
	);
}
