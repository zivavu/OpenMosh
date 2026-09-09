import { describe, expect, it } from "bun:test";
import { hueToHex } from "../color";
import { EFFECT_DEFINITIONS } from "./definitions";
import { getDefinition, hydrateEffects, hydrateValues } from "./hydrate";
import type { EffectDefinition, EffectParam } from "./types";

/**
 * Params are looked up in the live registry rather than hard-coded, so these
 * stay honest when an effect's knobs are renamed or retuned. Everything here
 * is about *how* a stored value is reconciled, not about any one effect.
 */
function findParam<T extends EffectParam["type"]>(
	type: T,
	match: (param: Extract<EffectParam, { type: T }>) => boolean = () => true,
): { def: EffectDefinition; param: Extract<EffectParam, { type: T }> } {
	for (const def of EFFECT_DEFINITIONS) {
		for (const param of def.params) {
			if (param.type === type) {
				const typed = param as Extract<EffectParam, { type: T }>;
				if (match(typed)) return { def, param: typed };
			}
		}
	}
	throw new Error(`no ${type} param in the registry to test against`);
}

describe("getDefinition", () => {
	it("finds a definition by id and is undefined for one that's gone", () => {
		expect(getDefinition(EFFECT_DEFINITIONS[0].id)).toBe(EFFECT_DEFINITIONS[0]);
		expect(getDefinition("effect-deleted-three-versions-ago")).toBeUndefined();
	});
});

describe("hydrateValues", () => {
	it("fills in every param a stored chain is missing", () => {
		const def = EFFECT_DEFINITIONS[0];
		const hydrated = hydrateValues(def.id, {});
		for (const param of def.params) {
			expect(hydrated[param.key]).toBe(param.defaultValue);
		}
	});

	it("fills in the defaults for a chain saved with no values at all", () => {
		const def = EFFECT_DEFINITIONS[0];
		expect(hydrateValues(def.id, undefined)).toEqual(
			Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue])),
		);
	});

	it("keeps unknown keys, so a renamed param can find its value again", () => {
		const def = EFFECT_DEFINITIONS[0];
		const hydrated = hydrateValues(def.id, { retiredKnob: 7 });
		expect(hydrated.retiredKnob).toBe(7);
	});

	it("passes values through untouched for an effect it doesn't know", () => {
		expect(
			hydrateValues("effect-deleted-three-versions-ago", { a: 1 }),
		).toEqual({
			a: 1,
		});
		expect(
			hydrateValues("effect-deleted-three-versions-ago", undefined),
		).toEqual({});
	});

	it("doesn't mutate the stored object it was handed", () => {
		const def = EFFECT_DEFINITIONS[0];
		const stored = { retiredKnob: 1 };
		hydrateValues(def.id, stored);
		expect(stored).toEqual({ retiredKnob: 1 });
	});

	describe("a range param", () => {
		const { def, param } = findParam("range", (p) => p.max > p.min);

		it("clamps a value that fell outside a narrowed range", () => {
			expect(
				hydrateValues(def.id, { [param.key]: param.max + 1000 })[param.key],
			).toBe(param.max);
			expect(
				hydrateValues(def.id, { [param.key]: param.min - 1000 })[param.key],
			).toBe(param.min);
		});

		it("accepts a number that arrived as a string", () => {
			expect(
				hydrateValues(def.id, { [param.key]: String(param.min) })[param.key],
			).toBe(param.min);
		});

		it("falls back to the default for anything that isn't a number", () => {
			// "" is in here on purpose: Number("") is 0, so a bare coercion would
			// quietly pin the slider to its min.
			for (const junk of ["", "   ", "abc", NaN, Infinity, -Infinity]) {
				expect(hydrateValues(def.id, { [param.key]: junk })[param.key]).toBe(
					param.defaultValue,
				);
			}
		});
	});

	describe("a select param", () => {
		const { def, param } = findParam("select");

		it("keeps an option that still exists", () => {
			const option = param.options[0].value;
			expect(hydrateValues(def.id, { [param.key]: option })[param.key]).toBe(
				option,
			);
		});

		it("falls back to the default when the option was removed", () => {
			expect(
				hydrateValues(def.id, { [param.key]: "mode-that-was-cut" })[param.key],
			).toBe(param.defaultValue);
		});

		it("won't take a number in place of an option", () => {
			expect(hydrateValues(def.id, { [param.key]: 0 })[param.key]).toBe(
				param.defaultValue,
			);
		});
	});

	describe("a checkbox param", () => {
		const { def, param } = findParam("checkbox");

		it("keeps a stored 0 or 1", () => {
			expect(hydrateValues(def.id, { [param.key]: 0 })[param.key]).toBe(0);
			expect(hydrateValues(def.id, { [param.key]: 1 })[param.key]).toBe(1);
		});

		it('falls back to the default for a string, including "0"', () => {
			// "0" is truthy, so a checkbox that took it would read as on.
			expect(hydrateValues(def.id, { [param.key]: "0" })[param.key]).toBe(
				param.defaultValue,
			);
		});
	});

	describe("a text param", () => {
		const { def, param } = findParam("text");

		it("keeps any string, empty included", () => {
			expect(hydrateValues(def.id, { [param.key]: "" })[param.key]).toBe("");
			expect(hydrateValues(def.id, { [param.key]: "hello" })[param.key]).toBe(
				"hello",
			);
		});

		it("falls back to the default for a number", () => {
			expect(hydrateValues(def.id, { [param.key]: 12 })[param.key]).toBe(
				param.defaultValue,
			);
		});
	});

	describe("a color param", () => {
		const { def, param } = findParam("color");

		it("keeps a full hex, in either case", () => {
			expect(hydrateValues(def.id, { [param.key]: "#1a2b3c" })[param.key]).toBe(
				"#1a2b3c",
			);
			expect(hydrateValues(def.id, { [param.key]: "#AABBCC" })[param.key]).toBe(
				"#AABBCC",
			);
		});

		it("rejects anything the shader couldn't parse", () => {
			// Shorthand included: the uniform upload expects six digits.
			for (const junk of ["#abc", "abcdef", "red", "#12345g", 255, ""]) {
				expect(hydrateValues(def.id, { [param.key]: junk })[param.key]).toBe(
					param.defaultValue,
				);
			}
		});
	});

	describe("duotone's hues, saved before it took colors", () => {
		it("rebuilds both colors the old shader would have produced", () => {
			const hydrated = hydrateValues("duotone", {
				shadowHue: 200,
				highlightHue: 40,
			});
			expect(hydrated.shadowColor).toBe(hueToHex(200, 0.3));
			expect(hydrated.highlightColor).toBe(hueToHex(40));
		});

		it("leaves a color the user has since picked alone", () => {
			const hydrated = hydrateValues("duotone", {
				shadowHue: 200,
				shadowColor: "#123456",
			});
			expect(hydrated.shadowColor).toBe("#123456");
		});

		it("migrates each hue on its own", () => {
			const hydrated = hydrateValues("duotone", { shadowHue: 200 });
			expect(hydrated.shadowColor).toBe(hueToHex(200, 0.3));
			expect(hydrated.highlightColor).toBe(
				getDefinition("duotone")?.params.find((p) => p.key === "highlightColor")
					?.defaultValue,
			);
		});

		it("doesn't touch the same keys on another effect", () => {
			const hydrated = hydrateValues(EFFECT_DEFINITIONS[0].id, {
				shadowHue: 200,
			});
			expect(hydrated.shadowColor).toBeUndefined();
		});
	});
});

describe("hydrateEffects", () => {
	const known = EFFECT_DEFINITIONS[0].id;

	it("is empty for anything that isn't a list", () => {
		// localStorage can hold whatever a half-finished write left behind.
		for (const junk of [null, undefined, {}, "[]", 3]) {
			expect(hydrateEffects(junk)).toEqual([]);
		}
	});

	it("drops an instance whose effect no longer exists", () => {
		const chain = hydrateEffects([
			{ defId: known, instanceId: "a", enabled: true, values: {} },
			{
				defId: "effect-deleted-three-versions-ago",
				instanceId: "b",
				values: {},
			},
		]);
		expect(chain.map((e) => e.instanceId)).toEqual(["a"]);
	});

	it("drops holes left in a stored chain", () => {
		expect(hydrateEffects([null, undefined])).toEqual([]);
	});

	it("keeps the instance id it was saved with", () => {
		const chain = hydrateEffects([
			{ defId: known, instanceId: "keep-me", values: {} },
		]);
		expect(chain[0].instanceId).toBe("keep-me");
	});

	it("mints an id for an instance saved without one", () => {
		const chain = hydrateEffects([
			{ defId: known, values: {} },
			{ defId: known, values: {} },
		]);
		expect(chain[0].instanceId).toBeTruthy();
		expect(chain[0].instanceId).not.toBe(chain[1].instanceId);
	});

	it("hydrates the values of every survivor", () => {
		const def = EFFECT_DEFINITIONS[0];
		const chain = hydrateEffects([
			{ defId: def.id, instanceId: "a", values: {} },
		]);
		for (const param of def.params) {
			expect(chain[0].values[param.key]).toBe(param.defaultValue);
		}
	});

	it("carries the rest of the instance across untouched", () => {
		const chain = hydrateEffects([
			{
				defId: known,
				instanceId: "a",
				enabled: false,
				locked: true,
				values: {},
			},
		]);
		expect(chain[0].enabled).toBe(false);
		expect(chain[0].locked).toBe(true);
	});
});

describe("the definition registry", () => {
	it("gives every param a default its own control would accept", () => {
		// A default outside its own range, or a select default missing from its
		// options, only shows up as a slider that jumps the first time a chain is
		// restored. hydrateValues reconciling it away is the tell.
		const wrong: string[] = [];
		for (const def of EFFECT_DEFINITIONS) {
			const hydrated = hydrateValues(
				def.id,
				Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue])),
			);
			for (const param of def.params) {
				if (hydrated[param.key] !== param.defaultValue) {
					wrong.push(`${def.id}.${param.key}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	it("keeps a mosh range inside the param's own range", () => {
		const wrong: string[] = [];
		for (const def of EFFECT_DEFINITIONS) {
			for (const param of def.params) {
				if (param.type !== "range") continue;
				const lo = param.moshMin ?? param.min;
				const hi = param.moshMax ?? param.max;
				if (lo < param.min || hi > param.max || lo > hi) {
					wrong.push(`${def.id}.${param.key}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	it("only lets a mosh roll select options that exist", () => {
		const wrong: string[] = [];
		for (const def of EFFECT_DEFINITIONS) {
			for (const param of def.params) {
				if (param.type !== "select" || !param.moshOptions) continue;
				const options = new Set(param.options.map((o) => o.value));
				for (const value of param.moshOptions) {
					if (!options.has(value))
						wrong.push(`${def.id}.${param.key}:${value}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	it("gives every param key one meaning per effect", () => {
		const wrong: string[] = [];
		for (const def of EFFECT_DEFINITIONS) {
			const seen = new Set<string>();
			for (const param of def.params) {
				if (seen.has(param.key)) wrong.push(`${def.id}.${param.key}`);
				seen.add(param.key);
			}
		}
		expect(wrong).toEqual([]);
	});
});
