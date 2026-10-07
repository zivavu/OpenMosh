import { describe, expect, it } from "bun:test";
import {
	EFFECT_DEFINITIONS,
	FREQ_PRESETS,
	loadInitialEffects,
} from "../effects";
import { withSeededRandom } from "./sequence";
import { MASK_EFFECT_ID } from "../effects/catalog/mask";
import {
	applyRandomAudioLinks,
	clearEffects,
	generateMosh,
	randomizeParams,
	type MoshOptions,
} from "./mosh";

/** Every link a roll produced, flattened across effects. */
function rolledLinks(band?: Parameters<typeof applyRandomAudioLinks>[3]) {
	const effects = loadInitialEffects();
	for (const e of effects) e.enabled = true;
	applyRandomAudioLinks(effects, true, 1, band);
	return effects.flatMap((e) => Object.values(e.volumeLinks ?? {}));
}

describe("applyRandomAudioLinks", () => {
	it("puts every rolled link on the chosen band", () => {
		const links = rolledLinks("low");
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) {
			expect(link.freqMin).toBe(FREQ_PRESETS.low.min);
			expect(link.freqMax).toBe(FREQ_PRESETS.low.max);
		}
	});

	it("leaves the band off the link for full spectrum", () => {
		// Unset is what resolves to the overall level in applyVolumeLinksToEffects.
		for (const link of rolledLinks("full")) {
			expect(link.freqMin).toBeUndefined();
			expect(link.freqMax).toBeUndefined();
		}
	});

	it("defaults to full spectrum", () => {
		for (const link of rolledLinks()) expect(link.freqMin).toBeUndefined();
	});
});

describe("randomizeParams", () => {
	it("lands every range param on its own step grid", () => {
		for (const def of EFFECT_DEFINITIONS) {
			const values: Record<string, number | string> = {};
			// Many rolls per definition: the value is random, the grid is not.
			for (let i = 0; i < 50; i++) {
				randomizeParams(values, def);
				for (const param of def.params) {
					if (param.type !== "range" || param.step <= 0) continue;
					const v = values[param.key] as number;
					const offGrid = (v - param.min) / param.step;
					expect(Math.abs(offGrid - Math.round(offGrid))).toBeLessThan(1e-6);
					expect(v).toBeGreaterThanOrEqual(param.min);
					expect(v).toBeLessThanOrEqual(param.max);
				}
			}
		}
	});

	it("leaves a stepless range param unquantized", () => {
		const def = {
			id: "t",
			name: "T",
			params: [
				{
					key: "a",
					label: "A",
					type: "range",
					min: 0,
					max: 1,
					step: 0,
					defaultValue: 0,
				},
			],
		} as unknown as (typeof EFFECT_DEFINITIONS)[number];
		const values: Record<string, number | string> = {};
		randomizeParams(values, def);
		expect(typeof values.a).toBe("number");
		expect(Number.isFinite(values.a as number)).toBe(true);
	});
});

describe("generateMosh for a 3D model", () => {
	const options: MoshOptions = {
		moshMin: 2,
		moshMax: 4,
		randomizeOrder: true,
		moshAudioLink: false,
		moshAudioLinkStrength: 0,
		hasAudio: false,
	};
	const turnOf = (effects: ReturnType<typeof loadInitialEffects>) =>
		effects.find((e) => e.defId === "transform-3d")!;

	function rolled(seed: number, over: Partial<MoshOptions> = {}) {
		const effects = loadInitialEffects();
		withSeededRandom(seed, () =>
			generateMosh(effects, { ...options, ...over }),
		);
		return effects;
	}

	it("always turns a model, whichever style rolls", () => {
		for (const moshStyle of ["random", "curated"] as const) {
			for (let seed = 1; seed <= 20; seed++) {
				const turn = turnOf(rolled(seed, { model: true, moshStyle }));
				expect(turn.enabled).toBe(true);
				expect(Math.abs(turn.values.rotY as number)).toBeLessThanOrEqual(55);
			}
		}
	});

	it("puts a model's turn at the head of the chain", () => {
		for (const moshStyle of ["random", "curated"] as const) {
			for (let seed = 1; seed <= 20; seed++) {
				const effects = rolled(seed, { model: true, moshStyle });
				expect(effects[0].defId).toBe("transform-3d");
			}
		}
	});

	it("never turns flat media in a curated roll", () => {
		for (let seed = 1; seed <= 20; seed++) {
			expect(turnOf(rolled(seed, { moshStyle: "curated" })).enabled).toBe(
				false,
			);
		}
	});

	it("turns off an unlocked 3D Transform a curated roll can't pick", () => {
		const effects = loadInitialEffects();
		turnOf(effects).enabled = true;
		withSeededRandom(4, () =>
			generateMosh(effects, { ...options, moshStyle: "curated" }),
		);
		expect(turnOf(effects).enabled).toBe(false);
	});

	it("leaves a locked 3D Transform as it was", () => {
		const effects = loadInitialEffects();
		const turn = turnOf(effects);
		turn.locked = true;
		turn.values.rotY = 90;
		withSeededRandom(3, () =>
			generateMosh(effects, { ...options, model: true }),
		);
		expect(turn.enabled).toBe(false);
		expect(turn.values.rotY).toBe(90);
	});
});

describe("generateMosh styles", () => {
	const options: MoshOptions = {
		moshMin: 3,
		moshMax: 3,
		randomizeOrder: true,
		moshAudioLink: false,
		moshAudioLinkStrength: 0,
		hasAudio: false,
	};
	const unpickable = EFFECT_DEFINITIONS.filter((d) => d.moshable === false).map(
		(d) => d.id,
	);

	it("lets a random roll pick any unlocked effect", () => {
		const seen = new Set<string>();
		for (let seed = 1; seed <= 400; seed++) {
			const effects = loadInitialEffects();
			withSeededRandom(seed, () => generateMosh(effects, options));
			for (const e of effects) if (e.enabled) seen.add(e.defId);
		}
		expect(unpickable.some((id) => seen.has(id))).toBe(true);
	});

	it("puts a roll's live effects first, in either style", () => {
		for (const moshStyle of ["random", "curated"] as const) {
			for (const model of [false, true]) {
				for (let seed = 1; seed <= 20; seed++) {
					const effects = loadInitialEffects();
					withSeededRandom(seed, () =>
						generateMosh(effects, { ...options, moshStyle, model }),
					);
					const firstOff = effects.findIndex((e) => !e.enabled);
					expect(effects.slice(firstOff).some((e) => e.enabled)).toBe(false);
				}
			}
		}
	});

	it("keeps curated rolls off the unpickable list", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const effects = loadInitialEffects();
			withSeededRandom(seed, () =>
				generateMosh(effects, { ...options, moshStyle: "curated" }),
			);
			for (const e of effects) {
				if (unpickable.includes(e.defId)) expect(e.enabled).toBe(false);
			}
		}
	});

	it("picks music-only effects only when there is music", () => {
		const musicOnly = EFFECT_DEFINITIONS.filter((d) => d.needsAudio).map(
			(d) => d.id,
		);
		const picked = (hasAudio: boolean) => {
			const seen = new Set<string>();
			for (let seed = 1; seed <= 400; seed++) {
				const effects = loadInitialEffects();
				withSeededRandom(seed, () =>
					generateMosh(effects, { ...options, hasAudio }),
				);
				for (const e of effects) if (e.enabled) seen.add(e.defId);
			}
			return musicOnly.some((id) => seen.has(id));
		};
		expect(musicOnly.length).toBeGreaterThan(0);
		expect(picked(false)).toBe(false);
		expect(picked(true)).toBe(true);
	});
});

describe("Mask effects", () => {
	const options: MoshOptions = {
		moshMin: 6,
		moshMax: 10,
		randomizeOrder: true,
		moshAudioLink: true,
		moshAudioLinkStrength: 1,
		hasAudio: true,
	};

	it("ride through every roll and clear exactly as they were", () => {
		for (const moshStyle of ["random", "curated"] as const) {
			for (let seed = 1; seed <= 30; seed++) {
				const effects = loadInitialEffects();
				const at = effects.findIndex((e) => e.defId === MASK_EFFECT_ID);
				const mask = effects[at];
				mask.enabled = true;
				mask.values.shape = "rect";
				const before = structuredClone(mask);
				withSeededRandom(seed, () =>
					generateMosh(effects, { ...options, moshStyle }),
				);
				clearEffects(effects);
				expect(effects[at]).toEqual(before);
			}
		}
	});
});
