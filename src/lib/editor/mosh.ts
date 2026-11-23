import {
	FREQ_PRESETS,
	getDefinition,
	type EffectDefinition,
	type EffectInstance,
	type FreqBand,
	type RangeParam,
	type VolumeLink,
} from "../effects";
import { TRANSFORM_3D_ID } from "../mesh/camera";
import { isMaskEffect } from "../effects/catalog/mask";
import { shuffleInPlace } from "../utils";
import { hsvToHex } from "../color";
import type { Family } from "../effects/curation";
import { curationOf, isCurated } from "../effects/curation";
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
	/** Rolling for a single saved frame: effects that need playback stay off. */
	still?: boolean;
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
 * random takes anything unlocked. Without music, neither picks a `needsAudio` one,
 * and a roll for a still never picks a `needsPlayback` one. */
export function isRollable(
	effect: EffectInstance,
	style: MoshStyle = "random",
	hasAudio = true,
	still = false,
): boolean {
	const def = getDefinition(effect.defId);
	return (
		isMoshable(effect) &&
		(style !== "curated" || def?.moshable !== false) &&
		(hasAudio || !def?.needsAudio) &&
		!(still && def?.needsPlayback)
	);
}

/** Roll fresh values for every randomizable param of one effect, in place. Ranges
 * land between the `bias` shares of their span. */
export function randomizeParams(
	values: Record<string, number | string>,
	def: EffectDefinition,
	bias: [number, number] = [0.15, 0.7],
): void {
	for (const param of def.params) {
		if (param.type === "range") {
			const lo = param.moshMin ?? param.min;
			const hi = param.moshMax ?? param.max;
			const share = bias[0] + Math.random() * (bias[1] - bias[0]);
			const raw = lo + share * (hi - lo);
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

/** A random range for a param's music link; `strength` (0-1) sets how wide it runs. */
function randomLinkRange(
	param: RangeParam,
	strength: number,
): { min: number; max: number } {
	const pMin = param.moshMin ?? param.min;
	const pMax = param.moshMax ?? param.max;
	const span = pMax - pMin;
	// Center position is independent of width so they don't limit each other
	const centerT = Math.random();
	// Width is guaranteed [50%-100%] of span at strength=1, scaled down linearly
	const widthFraction = strength * (0.5 + Math.random() * 0.5);
	const halfW = widthFraction / 2;
	let min = pMin + Math.max(0, centerT - halfW) * span;
	let max = pMin + Math.min(1, centerT + halfW) * span;
	if (param.step > 0) {
		const snap = (v: number) =>
			Math.round((v - pMin) / param.step) * param.step + pMin;
		min = snap(min);
		max = snap(max);
		if (max <= min) max = Math.min(pMax, min + param.step);
	}
	return { min, max };
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

			const { min: vMin, max: vMax } = randomLinkRange(param, strength);

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
	const rollable = (e: EffectInstance) =>
		isRollable(e, style, options.hasAudio, options.still);
	for (const e of effects) {
		if (isMoshable(e) && !rollable(e)) e.enabled = false;
	}
	const moshable = effects.filter(
		(e) => rollable(e) && (!onlyMoshEnabled || e.enabled),
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
	// A roll writes fresh values, so the animation it replaces goes with them.
	for (const effect of effects)
		if (isMoshable(effect)) {
			delete effect.keys;
			delete effect.keyLinks;
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
		for (const slots of maskScopeSlots(effects, isMoshable)) {
			const moved = shuffleInPlace(slots.map((i) => effects[i]));
			slots.forEach((slot, k) => (effects[slot] = moved[k]));
		}
	}
}

/** The chain's indices that `pick` takes, grouped by the stretches a Mask closes: a
 * Mask limits what sits above it, so moving an effect past one changes the picture. */
function maskScopeSlots(
	effects: EffectInstance[],
	pick: (e: EffectInstance) => boolean,
): number[][] {
	const scopes: number[][] = [[]];
	effects.forEach((e, i) => {
		if (isMaskEffect(e)) scopes.push([]);
		else if (pick(e)) scopes[scopes.length - 1].push(i);
	});
	return scopes.filter((s) => s.length > 1);
}

/** Reorders the effects in each Mask's scope by `rank`, keeping ties as they were. */
function sortWithinMaskScopes(
	effects: EffectInstance[],
	pick: (e: EffectInstance) => boolean,
	rank: (e: EffectInstance) => number,
): void {
	for (const slots of maskScopeSlots(effects, pick)) {
		const moved = slots
			.map((i) => effects[i])
			.map((e, k) => ({ e, k }))
			.sort((a, b) => rank(a.e) - rank(b.e) || a.k - b.k)
			.map(({ e }) => e);
		slots.forEach((slot, k) => (effects[slot] = moved[k]));
	}
}

/** Moves the unlocked effects that are on ahead of the ones that are off, keeping
 * their order and their Mask's scope. Off effects don't draw, so the picture is unchanged. */
function enabledFirst(effects: EffectInstance[]): void {
	sortWithinMaskScopes(effects, isMoshable, (e) => (e.enabled ? 0 : 1));
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
		// One a roll never picks, like a Mask, has no family to fill.
		if (!e.enabled || pool.includes(e) || !isCurated(e.defId)) continue;
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
	const order = [
		...curatedOrder(picked),
		...pool.filter((e) => !picked.includes(e)),
	];
	sortWithinMaskScopes(
		effects,
		(e) => pool.includes(e),
		(e) => order.indexOf(e),
	);
}

/** Text is the user's words, and paint, images and keys belong to a Mask. */
const ROLLED_TYPES = new Set(["range", "select", "color", "checkbox"]);

/** A vivid color: any hue, never grey or near black. */
function randomColor(): string {
	return hsvToHex({
		h: Math.random() * 360,
		s: 0.6 + Math.random() * 0.4,
		v: 0.55 + Math.random() * 0.45,
	});
}

/** Effects with a per-effect reroll: a Mask is only what the user drew, and an
 * effect with only words has nothing to roll. */
export function canReroll(effect: EffectInstance): boolean {
	const def = getDefinition(effect.defId);
	return (
		!!def &&
		!isMaskEffect(effect) &&
		def.params.some((p) => ROLLED_TYPES.has(p.type))
	);
}

/** One effect rolled on its own, in place, and switched on. Its music links keep
 * their params and band and get fresh ranges; its keys go, as with any roll. */
export function rerollEffect(effect: EffectInstance): void {
	const def = getDefinition(effect.defId);
	if (!def || !canReroll(effect)) return;
	randomizeParams(effect.values, def);
	for (const param of def.params) {
		if (param.type === "color") effect.values[param.key] = randomColor();
		if (param.type === "checkbox")
			effect.values[param.key] = Math.random() < 0.5 ? 0 : 1;
		const link = effect.volumeLinks?.[param.key];
		if (!link || param.type !== "range") continue;
		effect.volumeLinks![param.key] = {
			...link,
			...randomLinkRange(param, 0.8),
		};
	}
	delete effect.keys;
	delete effect.keyLinks;
	effect.enabled = true;
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
