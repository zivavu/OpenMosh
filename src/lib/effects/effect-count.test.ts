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
			expect(text).toContain(`${EFFECT_DEFINITIONS.length} effects`);
		});
	}
});
