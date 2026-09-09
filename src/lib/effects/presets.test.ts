import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	installFakeLocalStorage,
	type FakeLocalStorage,
} from "../testing/fake-storage";
import { EFFECT_DEFINITIONS } from "./definitions";
import {
	applyPreset,
	deletePreset,
	loadPresets,
	normalizePresetName,
	PRESET_NAME_MAX_LENGTH,
	savePreset,
	updatePreset,
} from "./presets";
import { STARTER_PRESETS } from "./starter-presets";
import type { EffectInstance, Preset } from "./types";

const PRESETS_KEY = "openmosh-presets";
const SEEDED_KEY = "openmosh-presets-seeded";

let ls: FakeLocalStorage;

beforeEach(() => {
	ls = installFakeLocalStorage();
});

afterEach(() => {
	ls.restore();
});

const DEF = EFFECT_DEFINITIONS[0];

function instance(over: Partial<EffectInstance> = {}): EffectInstance {
	return {
		instanceId: "live-id",
		defId: DEF.id,
		enabled: true,
		locked: false,
		expanded: false,
		values: {},
		...over,
	};
}

function stored(): Preset[] {
	return JSON.parse(ls.store.get(PRESETS_KEY) ?? "null");
}

describe("loadPresets", () => {
	it("seeds the starters on a first run", () => {
		expect(loadPresets()).toEqual(STARTER_PRESETS);
		expect(stored()).toEqual(STARTER_PRESETS);
		expect(ls.store.get(SEEDED_KEY)).toBe("1");
	});

	it("hands back a copy, so editing one preset can't rewrite the starters", () => {
		const first = loadPresets();
		first[0].name = "renamed in place";
		expect(STARTER_PRESETS[0].name).not.toBe("renamed in place");
	});

	it("reads back what was stored instead of re-seeding", () => {
		const mine: Preset[] = [{ name: "mine", effects: [] }];
		ls.seedJson(PRESETS_KEY, mine);
		expect(loadPresets()).toEqual(mine);
	});

	it("stays empty once the user has deleted every starter", () => {
		// The seeded flag is the whole point: an empty list must not read as a
		// first run and bring them all back.
		ls.seedJson(PRESETS_KEY, []);
		ls.seed(SEEDED_KEY, "1");
		expect(loadPresets()).toEqual([]);
	});

	it("stays empty when the list is gone but the run was already seeded", () => {
		ls.seed(SEEDED_KEY, "1");
		expect(loadPresets()).toEqual([]);
		expect(ls.store.has(PRESETS_KEY)).toBe(false);
	});

	it("seeds only once even if the write never lands", () => {
		// A private window can't persist anything; it should still get the
		// starters in memory rather than an empty panel.
		ls.full = true;
		expect(loadPresets()).toEqual(STARTER_PRESETS);
	});
});

describe("normalizePresetName", () => {
	it("trims the surrounding whitespace", () => {
		expect(normalizePresetName("  glitchy  ")).toBe("glitchy");
	});

	it("cuts an over-long name to the row it has to fit", () => {
		const name = normalizePresetName("x".repeat(PRESET_NAME_MAX_LENGTH + 20));
		expect(name.length).toBe(PRESET_NAME_MAX_LENGTH);
	});

	it("doesn't leave a trailing space behind the cut", () => {
		const name = normalizePresetName(
			`${"x".repeat(PRESET_NAME_MAX_LENGTH - 1)} yz`,
		);
		expect(name).toBe("x".repeat(PRESET_NAME_MAX_LENGTH - 1));
	});

	it("collapses a name that was only whitespace", () => {
		expect(normalizePresetName("   ")).toBe("");
	});
});

describe("savePreset", () => {
	beforeEach(() => {
		ls.seedJson(PRESETS_KEY, []);
		ls.seed(SEEDED_KEY, "1");
	});

	it("appends the preset and persists the list", () => {
		savePreset("one", [instance()]);
		const list = savePreset("two", [instance()]);
		expect(list.map((p) => p.name)).toEqual(["one", "two"]);
		expect(stored().map((p) => p.name)).toEqual(["one", "two"]);
	});

	it("normalizes the name on the way in", () => {
		expect(savePreset("  spaced  ", [])[0].name).toBe("spaced");
	});

	it("keeps only what a preset needs, dropping the live instance state", () => {
		const [preset] = savePreset("one", [
			instance({
				instanceId: "live-id",
				locked: true,
				expanded: true,
				enabled: false,
			}),
		]);
		expect(preset.effects[0]).toEqual({
			defId: DEF.id,
			enabled: false,
			values: {},
		});
	});

	it("omits an empty volumeLinks rather than bloating every entry", () => {
		const [preset] = savePreset("one", [instance({ volumeLinks: {} })]);
		expect("volumeLinks" in preset.effects[0]).toBe(false);
	});

	it("carries a real volumeLinks across", () => {
		const links = { size: { min: 1, max: 9 } };
		const [preset] = savePreset("one", [instance({ volumeLinks: links })]);
		expect(preset.effects[0].volumeLinks).toEqual(links);
	});

	it("snapshots the links too, not just the map holding them", () => {
		const live = instance({ volumeLinks: { size: { min: 1, max: 9 } } });
		const [preset] = savePreset("one", [live]);
		live.volumeLinks!.size.max = 99;
		expect(preset.effects[0].volumeLinks!.size.max).toBe(9);
	});

	it("snapshots the values, so later edits don't reach back into the preset", () => {
		const live = instance({ values: { size: 5 } });
		const [preset] = savePreset("one", [live]);
		live.values.size = 99;
		expect(preset.effects[0].values.size).toBe(5);
	});
});

describe("updatePreset", () => {
	beforeEach(() => {
		ls.seedJson(PRESETS_KEY, [
			{ name: "one", effects: [] },
			{ name: "two", effects: [] },
		]);
		ls.seed(SEEDED_KEY, "1");
	});

	it("overwrites that preset's chain and leaves its name and neighbours alone", () => {
		const list = updatePreset(1, [instance({ values: { size: 3 } })]);
		expect(list[1].name).toBe("two");
		expect(list[1].effects[0].values).toEqual({ size: 3 });
		expect(list[0].effects).toEqual([]);
		expect(stored()[1].effects[0].values).toEqual({ size: 3 });
	});
});

describe("deletePreset", () => {
	beforeEach(() => {
		ls.seedJson(PRESETS_KEY, [
			{ name: "one", effects: [] },
			{ name: "two", effects: [] },
			{ name: "three", effects: [] },
		]);
		ls.seed(SEEDED_KEY, "1");
	});

	it("removes that one and closes the gap", () => {
		expect(deletePreset(1).map((p) => p.name)).toEqual(["one", "three"]);
		expect(stored().map((p) => p.name)).toEqual(["one", "three"]);
	});

	it("leaves the list alone for an index past the end", () => {
		expect(deletePreset(9).map((p) => p.name)).toEqual(["one", "two", "three"]);
	});

	it("can empty the list", () => {
		deletePreset(0);
		deletePreset(0);
		expect(deletePreset(0)).toEqual([]);
		expect(stored()).toEqual([]);
	});
});

describe("applyPreset", () => {
	it("gives every effect a fresh unique instance id", () => {
		const chain = applyPreset({
			name: "p",
			effects: [
				{ defId: DEF.id, enabled: true, values: {} },
				{ defId: DEF.id, enabled: true, values: {} },
			],
		});
		expect(chain[0].instanceId).toBeTruthy();
		expect(chain[0].instanceId).not.toBe(chain[1].instanceId);
	});

	it("starts every effect unlocked and collapsed", () => {
		const [effect] = applyPreset({
			name: "p",
			effects: [{ defId: DEF.id, enabled: true, values: {} }],
		});
		expect(effect.locked).toBe(false);
		expect(effect.expanded).toBe(false);
	});

	it("keeps whether the effect was saved switched off", () => {
		const [effect] = applyPreset({
			name: "p",
			effects: [{ defId: DEF.id, enabled: false, values: {} }],
		});
		expect(effect.enabled).toBe(false);
	});

	it("fills in params added since the preset was saved", () => {
		const [effect] = applyPreset({
			name: "p",
			effects: [{ defId: DEF.id, enabled: true, values: {} }],
		});
		for (const param of DEF.params) {
			expect(effect.values[param.key]).toBe(param.defaultValue);
		}
	});

	it("copies volumeLinks instead of sharing them with the stored preset", () => {
		const preset: Preset = {
			name: "p",
			effects: [
				{
					defId: DEF.id,
					enabled: true,
					values: {},
					volumeLinks: { size: { min: 0, max: 1 } },
				},
			],
		};
		const [effect] = applyPreset(preset);
		effect.volumeLinks!.size.max = 99;
		expect(preset.effects[0].volumeLinks!.size.max).toBe(1);
	});

	it("leaves volumeLinks off an effect that never had them", () => {
		const [effect] = applyPreset({
			name: "p",
			effects: [{ defId: DEF.id, enabled: true, values: {} }],
		});
		expect(effect.volumeLinks).toBeUndefined();
	});
});

describe("every starter preset", () => {
	it("names an effect that still exists", () => {
		const ids = new Set(EFFECT_DEFINITIONS.map((d) => d.id));
		const missing = STARTER_PRESETS.flatMap((p) =>
			p.effects
				.filter((e) => !ids.has(e.defId))
				.map((e) => `${p.name}:${e.defId}`),
		);
		expect(missing).toEqual([]);
	});

	it("survives being applied with its stored values intact", () => {
		// hydrateValues reconciling a value away means the starter was written
		// against a range the param no longer has.
		const drifted: string[] = [];
		for (const preset of STARTER_PRESETS) {
			const chain = applyPreset(preset);
			preset.effects.forEach((saved, i) => {
				for (const [key, value] of Object.entries(saved.values)) {
					if (chain[i].values[key] !== value) {
						drifted.push(`${preset.name}:${saved.defId}.${key}`);
					}
				}
			});
		}
		expect(drifted).toEqual([]);
	});

	it("links volume only to range params the effect actually has", () => {
		const wrong: string[] = [];
		for (const preset of STARTER_PRESETS) {
			for (const effect of preset.effects) {
				const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
				for (const key of Object.keys(effect.volumeLinks ?? {})) {
					const param = def?.params.find((p) => p.key === key);
					if (param?.type !== "range")
						wrong.push(`${preset.name}:${effect.defId}.${key}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	it("fits in the name row", () => {
		for (const preset of STARTER_PRESETS) {
			expect(preset.name).toBe(normalizePresetName(preset.name));
		}
	});
});
