import {
	FREQ_PRESETS,
	getDefinition,
	type EffectDefinition,
	type EffectInstance,
	type FreqBand,
	type VolumeLink,
} from "../effects";
import { TRANSFORM_3D_ID } from "../mesh/camera";
import { isMaskEffect } from "../effects/catalog/mask";
import { shuffleInPlace } from "../utils";
import type { Family } from "../effects/curation";
import { curationOf } from "../effects/curation";
import { applyHierarchy, curatedOrder, pickCurated } from "./curated-mosh";

/** Random scatters any effects in any order; curated composes. See curated-mosh.ts. */
export type MoshStyle = "random" | "curated";

export interface MoshOptions {
	moshMin: number;
	moshMax: number;
	/** Absent = random. */
	moshStyle?: MoshStyle;
	/** Random style only: curated sets its own order. */
	randomizeOrder: boolean;
	moshAudioLink: boolean;
	/** 0-1: controls how many params get linked and how wide their range is. */
	moshAudioLinkStrength: number;
	/** Band every rolled link listens to. Defaults to the full spectrum. */
	moshLinkBand?: FreqBand;
	hasAudio: boolean;
	/** When true, only enabled effects are included in random mosh. */
	onlyMoshEnabled?: boolean;
	/** Rolling for a 3D model: a 3D Transform always comes along to turn it. */
	model?: boolean;
}

/** Effects a roll may touch: locked ones are protected by the user, and a Mask
 * only means something where the user put it. */
export function isMoshable(effect: EffectInstance): boolean {
	return !effect.locked && !isMaskEffect(effect);
}

/** Effects a roll may switch on. Curated skips the ones marked `moshable: false`;
 * random takes anything unlocked. */
export function isRollable(
	effect: EffectInstance,
	style: MoshStyle = "random",
): boolean {
	return (
		isMoshable(effect) &&
		(style !== "curated" || getDefinition(effect.defId)?.moshable !== false)
	);
}

/** Roll fresh values for every randomizable param of one effect, in place. */
export function randomizeParams(
	values: Record<string, number | string>,
	def: EffectDefinition,
): void {
	for (const param of def.params) {
		if (param.type === "range") {
			const lo = param.moshMin ?? param.min;
			const hi = param.moshMax ?? param.max;
			const bias = 0.15 + Math.random() * 0.55;
			const raw = lo + bias * (hi - lo);
			values[param.key] =
				param.step > 0
					? Math.round((raw - param.min) / param.step) * param.step + param.min
					: raw;
		} else if (param.type === "select") {
			// An unmatched moshOptions entry would leave nothing to pick from; use the full list.
			const allowed = param.moshOptions;
			const opts = allowed?.length
				? param.options.filter((o) => allowed.includes(o.value))
				: param.options;
			const pool = opts.length > 0 ? opts : param.options;
			values[param.key] = pool[Math.floor(Math.random() * pool.length)].value;
		}
	}
}

/** Link a random share of range params to the music, all on the same band. */
export function applyRandomAudioLinks(
	effects: EffectInstance[],
	hasAudio: boolean,
	strength: number = 0.8,
	band: FreqBand = "full",
): void {
	if (!hasAudio || strength <= 0) {
		for (const effect of effects) {
			if (effect.volumeLinks && isMoshable(effect)) delete effect.volumeLinks;
		}
		return;
	}

	for (const effect of effects) {
		const def = getDefinition(effect.defId);
		if (!def || !isMoshable(effect)) continue;

		if (!effect.enabled) {
			if (effect.volumeLinks) delete effect.volumeLinks;
			continue;
		}

		const links: Record<string, VolumeLink> = {};

		for (const param of def.params) {
			if (param.type !== "range") continue;

			// Probability scales with strength: at 1.0 all params linked, at 0.0 none
			if (Math.random() > strength) continue;

			const pMin = param.moshMin ?? param.min;
			const pMax = param.moshMax ?? param.max;
			const span = pMax - pMin;
			// Center position is independent of width so they don't limit each other
			const centerT = Math.random();
			// Width is guaranteed [50%-100%] of span at strength=1, scaled down linearly
			const widthFraction = strength * (0.5 + Math.random() * 0.5);
			const halfW = widthFraction / 2;
			let vMin = pMin + Math.max(0, centerT - halfW) * span;
			let vMax = pMin + Math.min(1, centerT + halfW) * span;

			if (param.step > 0) {
				const snap = (v: number) =>
					Math.round((v - pMin) / param.step) * param.step + pMin;
				vMin = snap(vMin);
				vMax = snap(vMax);
				if (vMax <= vMin) vMax = Math.min(pMax, vMin + param.step);
			}

			// One band for the whole roll, chosen by the user; a random band per param reads as noise.
			links[param.key] =
				band === "full"
					? { min: vMin, max: vMax }
					: {
							min: vMin,
							max: vMax,
							freqMin: FREQ_PRESETS[band].min,
							freqMax: FREQ_PRESETS[band].max,
						};
		}

		if (Object.keys(links).length > 0) {
			effect.volumeLinks = links;
		} else if (effect.volumeLinks) {
			delete effect.volumeLinks;
		}
	}
}

/** Randomize effects: enable a random subset, randomize params, optionally shuffle order. */
export function generateMosh(
	effects: EffectInstance[],
	options: MoshOptions,
): void {
	const {
		moshMin,
		moshMax,
		randomizeOrder,
		moshAudioLink,
		moshAudioLinkStrength,
		moshLinkBand,
		onlyMoshEnabled,
	} = options;
	const style = options.moshStyle ?? "random";
	// Unlocked effects the style never picks still go off with the roll.
	for (const e of effects) {
		if (isMoshable(e) && !isRollable(e, style)) e.enabled = false;
	}
	const moshable = effects.filter(
		(e) => isRollable(e, style) && (!onlyMoshEnabled || e.enabled),
	);
	const clampedMin = Math.min(moshMin, moshable.length);
	const clampedMax = Math.min(moshMax, moshable.length);
	const target =
		clampedMin + Math.floor(Math.random() * (clampedMax - clampedMin + 1));

	if (style === "curated") {
		rollCurated(effects, moshable, target);
	} else {
		rollRandom(effects, moshable, target, randomizeOrder);
	}
	// Curated only orders its own picks; this also lifts them past effects it can't pick.
	enabledFirst(effects);
	if (options.model) turnModel(effects);

	if (moshAudioLink) {
		applyRandomAudioLinks(
			effects,
			options.hasAudio,
			moshAudioLinkStrength,
			moshLinkBand,
		);
	} else {
		for (const effect of effects) {
			if (effect.volumeLinks && isMoshable(effect)) delete effect.volumeLinks;
		}
	}
}

/** On top of the roll, not part of it: 3D Transform stays out of flat media's moshes. */
function turnModel(effects: EffectInstance[]): void {
	const turn = effects.find((e) => e.defId === TRANSFORM_3D_ID);
	if (!turn || turn.locked) return;
	const def = getDefinition(turn.defId);
	if (!def) return;
	turn.enabled = true;
	randomizeParams(turn.values, def);
	// The renderer runs it first on a model, so the list shows it there too.
	const from = effects.indexOf(turn);
	const to = effects.findIndex((e) => isMoshable(e));
	if (to < 0 || to >= from) return;
	effects.splice(from, 1);
	effects.splice(to, 0, turn);
}

function rollRandom(
	effects: EffectInstance[],
	moshable: EffectInstance[],
	target: number,
	randomizeOrder: boolean,
): void {
	const indices = shuffleInPlace(moshable.map((_, i) => i));
	const enabledSet = new Set(indices.slice(0, target));

	moshable.forEach((effect, i) => {
		effect.enabled = enabledSet.has(i);
		if (!effect.enabled) return;
		const def = getDefinition(effect.defId);
		if (!def) return;
		randomizeParams(effect.values, def);
	});

	if (randomizeOrder) {
		const moshableIndices = effects
			.map((e, i) => (isMoshable(e) ? i : -1))
			.filter((i) => i !== -1);
		const shuffled = shuffleInPlace([...moshableIndices]);
		const snapshot = effects.map((e) => ({ ...e }));
		for (let k = 0; k < moshableIndices.length; k++) {
			effects[moshableIndices[k]] = snapshot[shuffled[k]];
		}
	}
}

/** Moves the unlocked effects that are on ahead of the ones that are off, keeping
 * their order. Off effects don't draw, so the picture is unchanged. */
function enabledFirst(effects: EffectInstance[]): void {
	const slots = effects
		.map((e, i) => (isMoshable(e) ? i : -1))
		.filter((i) => i !== -1);
	const moved = slots.map((i) => effects[i]);
	const order = [
		...moved.filter((e) => e.enabled),
		...moved.filter((e) => !e.enabled),
	];
	slots.forEach((slot, k) => (effects[slot] = order[k]));
}

/** Picks into the slots `pool` holds, in chain order, the rest after them. */
function rollCurated(
	effects: EffectInstance[],
	pool: EffectInstance[],
	target: number,
): void {
	// What's already on and out of the roll's reach still fills its family.
	const taken = new Map<Family, number>();
	for (const e of effects) {
		if (!e.enabled || pool.includes(e)) continue;
		const family = curationOf(e.defId).family;
		taken.set(family, (taken.get(family) ?? 0) + 1);
	}
	for (const e of pool) e.enabled = false;
	const picked = pickCurated(pool, target, taken);
	for (const e of picked) {
		e.enabled = true;
		const def = getDefinition(e.defId);
		if (def) randomizeParams(e.values, def);
	}
	applyHierarchy(picked);
	const slots = effects
		.map((e, i) => (pool.includes(e) ? i : -1))
		.filter((i) => i !== -1);
	const order = [
		...curatedOrder(picked),
		...pool.filter((e) => !picked.includes(e)),
	];
	slots.forEach((slot, k) => (effects[slot] = order[k]));
}

export function clearEffects(effects: EffectInstance[]): void {
	for (const effect of effects) {
		if (!isMoshable(effect)) continue;
		effect.enabled = false;
		const def = getDefinition(effect.defId);
		if (!def) continue;
		for (const param of def.params) {
			effect.values[param.key] = param.defaultValue;
		}
	}
}
