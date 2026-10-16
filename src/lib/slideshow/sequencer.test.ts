import { describe, expect, it } from "bun:test";
import { EFFECT_DEFINITIONS, loadInitialEffects } from "../effects";
import { withSeededRandom } from "../editor/sequence";
import type { MoshOptions } from "../editor/mosh";
import { computeEffectsForBeat } from "./sequencer";
import { DEFAULT_SLIDESHOW_CONFIG } from "./types";

const OPTIONS: MoshOptions = {
	moshMin: 3,
	moshMax: 6,
	randomizeOrder: true,
	moshAudioLink: false,
	moshAudioLinkStrength: 0,
	hasAudio: false,
};

describe("computeEffectsForBeat random mode", () => {
	it("rolls curated, so effects a curated roll leaves out never turn on", () => {
		const excluded = new Set(
			EFFECT_DEFINITIONS.filter((d) => d.moshable === false).map((d) => d.id),
		);
		expect(excluded.size).toBeGreaterThan(0);

		const base = loadInitialEffects();
		for (let seed = 1; seed <= 200; seed++) {
			const beat = withSeededRandom(seed, () =>
				computeEffectsForBeat(
					{ ...DEFAULT_SLIDESHOW_CONFIG, moshMode: "random" },
					base,
					{ effects: base },
					OPTIONS,
				),
			);
			for (const e of beat) {
				if (e.enabled) expect(excluded.has(e.defId)).toBe(false);
			}
		}
	});
});
