/**
 * What every chain clip in the editor shares: the static/auto mode, the
 * re-roll spacings, the seeded roll and the labels. The lanes that hold such
 * clips — fx lanes and media layers — build on chain-clip.ts, which builds on
 * this. (The file keeps its name: the mode's saved data is keyed under
 * "sequence" everywhere, and so is the route.)
 */

import {
	getDefinition,
	loadInitialEffects,
	type EffectInstance,
} from "../effects";
import { generateMosh, type MoshOptions } from "./mosh";
import { mulberry32 } from "../rng";

export type ChainMode = "static" | "interval";

export const DEFAULT_INTERVAL_SEC = 0.25;

/**
 * Re-roll spacings offered once a BPM is known, as divisions of a beat. Tops
 * out at one per beat: a roll slower than the beat reads as missed cuts, not
 * a rhythm, so anything longer is left to the clip boundaries.
 */
export const BEAT_INTERVALS: { beats: number; label: string }[] = [
	{ beats: 0.03125, label: "1/32 beat" },
	{ beats: 0.0625, label: "1/16 beat" },
	{ beats: 0.125, label: "1/8 beat" },
	{ beats: 0.25, label: "1/4 beat" },
	{ beats: 0.5, label: "1/2 beat" },
	{ beats: 1, label: "every beat" },
];

/**
 * Compact wording for a re-roll spacing, for timeline labels. Beat-set
 * intervals read as beats: their seconds are a BPM division, so they print as
 * float noise ("1.1428571428571428s") and change meaning with the BPM.
 */
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

/**
 * Run fn with Math.random temporarily replaced by a seeded PRNG. Lets the
 * existing mosh generator (which draws from Math.random throughout) produce
 * reproducible results without a parallel seeded implementation.
 */
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

/**
 * Label for a chain the user built by hand: what it actually switches on, so
 * an edited span stops reading "clean". Preset- and mosh-filled chains keep
 * their own label instead, marked with a "*" once edited.
 */
export function handBuiltLabel(effects: EffectInstance[]): string {
	const on = effects.filter((e) => e.enabled);
	if (on.length === 0) return "clean";
	const first = (getDefinition(on[0].defId)?.name ?? on[0].defId).toLowerCase();
	return on.length === 1 ? first : `${first} +${on.length - 1}`;
}

/** True when a span's label is auto-derived from its chain rather than a
 * preset name or a mosh, so a hand-edit is free to re-derive it. */
export function isHandBuiltLabel(span: {
	label: string;
	presetName?: string;
}): boolean {
	return !span.presetName && span.label !== "mosh" && span.label !== "auto";
}

/** Deterministic mosh roll: same seed + options → same effects. */
export function rollEffects(
	seed: number,
	options: MoshOptions,
): EffectInstance[] {
	const effects = loadInitialEffects();
	withSeededRandom(seed, () => generateMosh(effects, options));
	return effects;
}
