import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EFFECT_DEFINITIONS } from "./definitions";

describe("effect count in the copy", () => {
	for (const file of ["README.md", "about/index.html"]) {
		test(file, () => {
			const text = readFileSync(
				new URL(`../../../${file}`, import.meta.url),
				"utf8",
			);
			// Every count the copy states, so a stale second mention or "169 effects" fails.
			const stated = [...text.matchAll(/\b(\d+)\s+effects\b/g)].map((m) =>
				Number(m[1]),
			);
			expect(stated.length).toBeGreaterThan(0);
			expect(stated).toEqual(stated.map(() => EFFECT_DEFINITIONS.length));
		});
	}
});
