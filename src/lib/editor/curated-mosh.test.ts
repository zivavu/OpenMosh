import { describe, expect, it } from "bun:test";
import {
	EFFECT_DEFINITIONS,
	getDefinition,
	loadInitialEffects,
} from "../effects";
import {
	CURATION,
	curationOf,
	FAMILIES,
	STAGES,
	type Family,
} from "../effects/curation";
import { pickCurated } from "./curated-mosh";
import { generateMosh, isMoshable, type MoshOptions } from "./mosh";
import { withSeededRandom } from "./sequence";

const OPTIONS: MoshOptions = {
	moshMin: 3,
	moshMax: 6,
	moshStyle: "curated",
	randomizeOrder: true,
	moshAudioLink: false,
	moshAudioLinkStrength: 0,
	hasAudio: false,
};

function roll(seed: number, options = OPTIONS) {
	const effects = loadInitialEffects();
	withSeededRandom(seed, () => generateMosh(effects, options));
	return effects;
}

/** What a roll decides; instance ids are minted fresh per chain. */
function shape(seed: number, options = OPTIONS) {
	return roll(seed, options).map((e) => [e.defId, e.enabled, e.values]);
}

describe("curation table", () => {
	it("covers every effect a roll may pick, and nothing else", () => {
		for (const def of EFFECT_DEFINITIONS) {
			if (def.moshable === false) expect(CURATION[def.id]).toBeUndefined();
			else expect(CURATION[def.id]).toBeDefined();
		}
		for (const id of Object.keys(CURATION))
			expect(getDefinition(id)).toBeDefined();
	});

	it("names a real range param as each effect's amount", () => {
		for (const [id, entry] of Object.entries(CURATION)) {
			if (!entry.amount) continue;
			const param = getDefinition(id)!.params.find(
				(p) => p.key === entry.amount!.key,
			);
			expect(param?.type).toBe("range");
		}
	});
});

describe("curated roll", () => {
	it("stays within the count and never past a family's cap", () => {
		for (let seed = 1; seed <= 60; seed++) {
			const on = roll(seed).filter((e) => e.enabled);
			expect(on.length).toBeLessThanOrEqual(OPTIONS.moshMax);
			expect(on.length).toBeGreaterThanOrEqual(1);
			const counts = new Map<Family, number>();
			for (const e of on) {
				const f = curationOf(e.defId).family;
				counts.set(f, (counts.get(f) ?? 0) + 1);
			}
			for (const [f, n] of counts)
				expect(n).toBeLessThanOrEqual(FAMILIES[f].cap);
		}
	});

	it("runs in signal-chain order, but for the odd swapped pair", () => {
		let broken = 0;
		for (let seed = 1; seed <= 100; seed++) {
			const stages = roll(seed)
				.filter((e) => e.enabled)
				.map((e) => STAGES.indexOf(curationOf(e.defId).stage));
			const drops = stages.filter((s, i) => i > 0 && s < stages[i - 1]).length;
			expect(drops).toBeLessThanOrEqual(1);
			broken += drops;
		}
		expect(broken).toBeGreaterThan(0);
		expect(broken).toBeLessThan(25);
	});

	it("leads with an effect that can carry a look", () => {
		const pool = loadInitialEffects().filter(isMoshable);
		for (let seed = 1; seed <= 60; seed++) {
			const [hero] = withSeededRandom(seed, () =>
				pickCurated(pool, 4, new Map()),
			);
			expect(FAMILIES[curationOf(hero.defId).family].hero).toBe(true);
		}
	});

	it("counts a locked effect against its family", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const effects = loadInitialEffects();
			const duotone = effects.find((e) => e.defId === "duotone")!;
			duotone.enabled = true;
			duotone.locked = true;
			withSeededRandom(seed, () => generateMosh(effects, OPTIONS));
			const palettes = effects.filter(
				(e) => e.enabled && curationOf(e.defId).family === "palette",
			);
			expect(palettes).toEqual([duotone]);
		}
	});

	it("is repeatable for a seed, as auto clips need", () => {
		expect(shape(7)).toEqual(shape(7));
	});

	it("leaves the random style exactly as it was", () => {
		const random = { ...OPTIONS, moshStyle: "random" as const };
		const { moshStyle: _, ...unset } = random;
		expect(shape(5, random)).toEqual(shape(5, unset));
		expect(shape(5, random)).not.toEqual(shape(5));
	});
});
