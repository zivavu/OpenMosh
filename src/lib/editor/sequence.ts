/** What every chain clip shares: mode, spacings, seeded roll and labels. */

import {
	cloneEffectInstance,
	getDefinition,
	loadInitialEffects,
	type EffectInstance,
} from "../effects";
import { generateMosh, type MoshOptions } from "./mosh";
import { mulberry32 } from "../rng";

export type ChainMode = "static" | "interval";

export const DEFAULT_INTERVAL_SEC = 0.25;

/** Re-roll spacings offered once a BPM is known, as divisions of a beat. */
export const BEAT_INTERVALS: { beats: number; label: string }[] = [
	{ beats: 0.03125, label: "1/32 beat" },
	{ beats: 0.0625, label: "1/16 beat" },
	{ beats: 0.125, label: "1/8 beat" },
	{ beats: 0.25, label: "1/4 beat" },
	{ beats: 0.5, label: "1/2 beat" },
	{ beats: 1, label: "every beat" },
];

/** Compact wording for a re-roll spacing, for timeline labels. */
export function intervalLabel(
	intervalSec: number | undefined,
	intervalBeats?: number | null,
): string {
	if (intervalBeats) {
		if (intervalBeats >= 1) {
			return `${intervalBeats} beat${intervalBeats === 1 ? "" : "s"}`;
		}
		return `1/${Math.round(1 / intervalBeats)} beat`;
	}
	const sec = intervalSec ?? DEFAULT_INTERVAL_SEC;
	// Number() drops the padding zeros toFixed adds to whole values.
	return `${Number(sec.toFixed(3))}s`;
}

/** Seconds between re-rolls for a beat spacing at `bpm`. */
export function beatsToSeconds(beats: number, bpm: number): number {
	if (bpm <= 0) return DEFAULT_INTERVAL_SEC;
	return (60 / bpm) * beats;
}

export function randomSeed(): number {
	return Math.floor(Math.random() * 0x7fffffff);
}

/** Run fn with Math.random temporarily replaced by a seeded PRNG. */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
	const original = Math.random;
	Math.random = mulberry32(seed);
	try {
		return fn();
	} finally {
		Math.random = original;
	}
}

/** Fresh all-disabled effect list (respects hidden effects). */
export function cleanEffects(): EffectInstance[] {
	return loadInitialEffects();
}

/** Label for a hand-built chain: what it switches on. */
export function handBuiltLabel(effects: EffectInstance[]): string {
	const on = effects.filter((e) => e.enabled);
	if (on.length === 0) return "clean";
	const first = (getDefinition(on[0].defId)?.name ?? on[0].defId).toLowerCase();
	return on.length === 1 ? first : `${first} +${on.length - 1}`;
}

/** True when a span's label is auto-derived from its chain, not a preset name or mosh. */
export function isHandBuiltLabel(span: {
	label: string;
	presetName?: string;
}): boolean {
	return !span.presetName && span.label !== "mosh" && span.label !== "auto";
}

/** A fresh chain that keeps `from`'s locked effects as they are, where they sat. */
export function keepLocked(
	fresh: EffectInstance[],
	from: EffectInstance[],
): EffectInstance[] {
	if (!from.some((e) => e.locked)) return fresh;
	const byDef = new Map(fresh.map((e) => [e.defId, e]));
	for (const e of from) if (e.locked) byDef.delete(e.defId);
	const out: EffectInstance[] = [];
	for (const e of from) {
		if (e.locked) {
			out.push(cloneEffectInstance(e));
			continue;
		}
		const f = byDef.get(e.defId);
		if (!f) continue;
		out.push(f);
		byDef.delete(e.defId);
	}
	return [...out, ...byDef.values()];
}

/** What a chain's locks hold, for cache keys: a roll over it changes with them. */
export function lockedKey(effects: EffectInstance[]): string {
	const locked = effects.filter((e) => e.locked);
	if (locked.length === 0) return "";
	return JSON.stringify(
		locked.map((e) => [
			effects.indexOf(e),
			e.defId,
			e.enabled,
			e.values,
			e.volumeLinks,
		]),
	);
}

/** Deterministic mosh roll: same seed + options → same effects. Effects locked in
 * `keep` ride through it untouched. */
export function rollEffects(
	seed: number,
	options: MoshOptions,
	keep: EffectInstance[] = [],
): EffectInstance[] {
	const effects = keepLocked(loadInitialEffects(), keep);
	withSeededRandom(seed, () => generateMosh(effects, options));
	return effects;
}
