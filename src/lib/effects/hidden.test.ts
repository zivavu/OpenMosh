import { describe, expect, it } from "bun:test";
import { loadInitialEffects, withoutHiddenEffects } from ".";

describe("withoutHiddenEffects", () => {
	it("drops every instance of a hidden effect", () => {
		const effects = loadInitialEffects();
		const [first, second] = effects;
		const chain = [first, second, { ...first, instanceId: "copy" }];
		expect(withoutHiddenEffects(chain, new Set([first.defId]))).toEqual([
			second,
		]);
	});

	it("hands the chain back as it was when nothing in it is hidden", () => {
		const effects = loadInitialEffects();
		expect(withoutHiddenEffects(effects, new Set(["no-such-effect"]))).toBe(
			effects,
		);
	});
});
