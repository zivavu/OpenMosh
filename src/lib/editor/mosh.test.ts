import { describe, expect, it } from "bun:test";
import {
	EFFECT_DEFINITIONS,
	FREQ_PRESETS,
	getDefinition,
	loadInitialEffects,
} from "../effects";
import { withSeededRandom } from "./sequence";
import { MASK_EFFECT_ID } from "../effects/catalog/mask";
import {
	applyRandomAudioLinks,
	canReroll,
	clearEffects,
	generateMosh,
	randomizeParams,
	rerollEffect,
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

describe("rerollEffect", () => {
	/** The first effect with a slider, switched off, its first slider keyed and linked. */
	function keyedAndLinked() {
		const effect = loadInitialEffects().find(
			(e) =>
				canReroll(e) &&
				getDefinition(e.defId)!.params.some((p) => p.type === "range"),
		)!;
		const param = getDefinition(effect.defId)!.params.find(
			(p) => p.type === "range",
		)!;
		effect.enabled = false;
		effect.keys = { [param.key]: [{ t: 0, v: 0 }] };
		effect.volumeLinks = {
			[param.key]: { min: -1, max: -1, freqMin: 20, freqMax: 500 },
		};
		return { effect, key: param.key };
	}

	it("switches the effect on and drops its keys", () => {
		const { effect } = keyedAndLinked();
		rerollEffect(effect);
		expect(effect.enabled).toBe(true);
		expect(effect.keys).toBeUndefined();
	});

	it("rolls a linked slider's range and keeps its band", () => {
		const { effect, key } = keyedAndLinked();
		rerollEffect(effect);
		const link = effect.volumeLinks![key];
		expect(link.min).not.toBe(-1);
		expect(link.max).toBeGreaterThan(link.min);
		expect(link.freqMin).toBe(20);
		expect(link.freqMax).toBe(500);
	});

	it("rolls only the effect it's given", () => {
		const effects = loadInitialEffects();
		const before = structuredClone(effects);
		const at = effects.findIndex(canReroll);
		withSeededRandom(3, () => rerollEffect(effects[at]));
		effects.forEach((e, i) => {
			if (i !== at) expect(e).toEqual(before[i]);
		});
		expect(effects[at].values).not.toEqual(before[at].values);
	});

	it("rolls an effect's colors", () => {
		const trio = loadInitialEffects().find((e) => e.defId === "trio-tone")!;
		const colorKeys = getDefinition(trio.defId)!
			.params.filter((p) => p.type === "color")
			.map((p) => p.key);
		const before = colorKeys.map((k) => trio.values[k]);
		withSeededRandom(5, () => rerollEffect(trio));
		const after = colorKeys.map((k) => trio.values[k]);
		expect(after).not.toEqual(before);
		for (const c of after) expect(c).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("rolls an effect's checkboxes", () => {
		const strobe = loadInitialEffects().find((e) => e.defId === "rgb-strobe")!;
		const seen = new Set<string>();
		for (let seed = 1; seed <= 20; seed++) {
			withSeededRandom(seed, () => rerollEffect(strobe));
			seen.add(
				`${strobe.values.red}${strobe.values.green}${strobe.values.blue}`,
			);
		}
		expect(seen.size).toBeGreaterThan(1);
		for (const combo of seen) expect(combo).toMatch(/^[01]{3}$/);
	});

	it("leaves a Mask alone", () => {
		const mask = loadInitialEffects().find((e) => e.defId === MASK_EFFECT_ID)!;
		const before = structuredClone(mask);
		expect(canReroll(mask)).toBe(false);
		rerollEffect(mask);
		expect(mask).toEqual(before);
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

	it("leaves playback-only effects off a roll for a still", () => {
		const playbackOnly = EFFECT_DEFINITIONS.filter((d) => d.needsPlayback).map(
			(d) => d.id,
		);
		const picked = (still: boolean) => {
			const seen = new Set<string>();
			for (let seed = 1; seed <= 400; seed++) {
				const effects = loadInitialEffects();
				for (const e of effects) e.enabled = playbackOnly.includes(e.defId);
				withSeededRandom(seed, () =>
					generateMosh(effects, { ...options, still }),
				);
				for (const e of effects) if (e.enabled) seen.add(e.defId);
			}
			return playbackOnly.some((id) => seen.has(id));
		};
		expect(playbackOnly).toContain("motion-mask");
		expect(picked(true)).toBe(false);
		expect(picked(false)).toBe(true);
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

	it("ride through every roll exactly as they were", () => {
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
				expect(effects[at]).toEqual(before);
			}
		}
	});

	it("go off and back to their defaults on a clear, unless locked", () => {
		const effects = loadInitialEffects();
		const mask = effects.find((e) => e.defId === MASK_EFFECT_ID)!;
		const pristine = structuredClone(mask.values);
		mask.enabled = true;
		mask.values.shape = "rect";
		clearEffects(effects);
		expect(mask.enabled).toBe(false);
		expect(mask.values).toEqual(pristine);

		mask.enabled = true;
		mask.values.shape = "rect";
		mask.locked = true;
		const before = structuredClone(mask);
		clearEffects(effects);
		expect(mask).toEqual(before);
	});

	it("never move an effect across one, which would change what it clips", () => {
		for (const moshStyle of ["random", "curated"] as const) {
			for (let seed = 1; seed <= 30; seed++) {
				const effects = loadInitialEffects();
				// Mid-chain, with rollable effects on both sides of it.
				const [mask] = effects.splice(
					effects.findIndex((e) => e.defId === MASK_EFFECT_ID),
					1,
				);
				const at = Math.floor(effects.length / 2);
				effects.splice(at, 0, mask);
				mask.enabled = true;
				const above = new Set(effects.slice(0, at).map((e) => e.instanceId));
				withSeededRandom(seed, () =>
					generateMosh(effects, { ...options, moshStyle }),
				);
				const nowAt = effects.findIndex((e) => e.defId === MASK_EFFECT_ID);
				expect(
					new Set(effects.slice(0, nowAt).map((e) => e.instanceId)),
				).toEqual(above);
			}
		}
	});
});
