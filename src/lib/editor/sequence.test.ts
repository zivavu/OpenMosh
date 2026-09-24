import { describe, expect, test } from "bun:test";
import type { MoshOptions } from "./mosh";
import {
	beatsToSeconds,
	DEFAULT_INTERVAL_SEC,
	intervalLabel,
	keepLocked,
	lockedKey,
	rollEffects,
	withSeededRandom,
} from "./sequence";

const OPTIONS: MoshOptions = {
	moshMin: 3,
	moshMax: 6,
	randomizeOrder: true,
	moshAudioLink: false,
	moshAudioLinkStrength: 0,
	hasAudio: false,
};

/** Compare two effect lists by the fields that drive render output. */
function renderShape(
	effects: {
		defId: string;
		enabled: boolean;
		values: Record<string, unknown>;
	}[],
) {
	return effects.map((e) => ({
		defId: e.defId,
		enabled: e.enabled,
		values: e.values,
	}));
}

describe("withSeededRandom", () => {
	test("same seed reproduces the same random stream", () => {
		const a = withSeededRandom(42, () => [
			Math.random(),
			Math.random(),
			Math.random(),
		]);
		const b = withSeededRandom(42, () => [
			Math.random(),
			Math.random(),
			Math.random(),
		]);
		expect(a).toEqual(b);
	});

	test("restores the global Math.random afterward", () => {
		const original = Math.random;
		withSeededRandom(1, () => Math.random());
		expect(Math.random).toBe(original);
	});

	test("different seeds diverge", () => {
		const a = withSeededRandom(1, () => Math.random());
		const b = withSeededRandom(2, () => Math.random());
		expect(a).not.toBe(b);
	});
});

describe("rollEffects determinism (preview/export contract)", () => {
	test("same seed + options → identical effects", () => {
		const a = rollEffects(12345, OPTIONS);
		const b = rollEffects(12345, OPTIONS);
		expect(renderShape(a)).toEqual(renderShape(b));
	});

	test("at least one enabled effect for a normal mosh", () => {
		const rolled = rollEffects(777, OPTIONS);
		expect(rolled.some((e) => e.enabled)).toBe(true);
	});

	test("different seeds generally produce different results", () => {
		const a = rollEffects(1, OPTIONS);
		const b = rollEffects(2, OPTIONS);
		expect(renderShape(a)).not.toEqual(renderShape(b));
	});
});

describe("locked effects", () => {
	/** A rolled chain with its last effect switched on, tuned and locked. */
	function withLockedLast() {
		const base = rollEffects(5, { ...OPTIONS, randomizeOrder: false });
		const last = base[base.length - 1];
		last.enabled = true;
		last.locked = true;
		return { base, last };
	}

	test("ride through a roll where they sat, as they were", () => {
		const { base, last } = withLockedLast();
		for (const seed of [1, 2, 3]) {
			const rolled = rollEffects(seed, OPTIONS, base);
			expect(rolled).toHaveLength(base.length);
			const kept = rolled[rolled.length - 1];
			expect(kept.defId).toBe(last.defId);
			expect(kept.enabled).toBe(true);
			expect(kept.locked).toBe(true);
			expect(kept.values).toEqual(last.values);
			expect(rolled.filter((e) => e.defId === last.defId)).toHaveLength(1);
		}
	});

	test("a locked chain still rolls deterministically", () => {
		const { base } = withLockedLast();
		expect(renderShape(rollEffects(9, OPTIONS, base))).toEqual(
			renderShape(rollEffects(9, OPTIONS, base)),
		);
	});

	test("keepLocked leaves a chain with no locks alone", () => {
		const fresh = rollEffects(1, OPTIONS);
		expect(keepLocked(fresh, rollEffects(2, OPTIONS))).toBe(fresh);
	});

	test("the lock key follows what the locks hold", () => {
		const { base, last } = withLockedLast();
		const before = lockedKey(base);
		expect(before).not.toBe("");
		last.enabled = false;
		expect(lockedKey(base)).not.toBe(before);
		last.locked = false;
		expect(lockedKey(base)).toBe("");
	});
});

describe("beat-based re-roll spacing", () => {
	test("converts beats to seconds at the given tempo", () => {
		expect(beatsToSeconds(1, 120)).toBeCloseTo(0.5, 6);
		expect(beatsToSeconds(4, 120)).toBeCloseTo(2, 6);
		expect(beatsToSeconds(0.5, 90)).toBeCloseTo(1 / 3, 6);
	});

	test("falls back to the default rather than dividing by a missing tempo", () => {
		expect(beatsToSeconds(1, 0)).toBe(DEFAULT_INTERVAL_SEC);
	});

	test("labels beat spacings as beats, not their BPM division in seconds", () => {
		expect(intervalLabel(beatsToSeconds(2, 105), 2)).toBe("2 beats");
		expect(intervalLabel(beatsToSeconds(1, 105), 1)).toBe("1 beat");
		expect(intervalLabel(beatsToSeconds(0.25, 105), 0.25)).toBe("1/4 beat");
		expect(intervalLabel(beatsToSeconds(0.03125, 105), 0.03125)).toBe(
			"1/32 beat",
		);
	});

	test("labels second spacings in seconds, without float noise", () => {
		expect(intervalLabel(0.25)).toBe("0.25s");
		expect(intervalLabel(2)).toBe("2s");
		expect(intervalLabel(1.1428571428571428)).toBe("1.143s");
		expect(intervalLabel(undefined)).toBe(`${DEFAULT_INTERVAL_SEC}s`);
	});
});
