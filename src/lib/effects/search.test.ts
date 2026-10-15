import { describe, expect, it } from "bun:test";
import { EFFECT_DEFINITIONS } from "./definitions";
import { effectMatchesSearch } from "./search";

const names = (query: string) =>
	EFFECT_DEFINITIONS.filter((def) => effectMatchesSearch(def, query)).map(
		(def) => def.id,
	);

describe("effectMatchesSearch", () => {
	it("matches a name, whatever its case and stray spaces", () => {
		expect(effectMatchesSearch({ id: "x", name: "Pixel Sort" }, " SORT ")).toBe(
			true,
		);
	});

	it("finds a whole family by its name", () => {
		const warps = names("warp");
		expect(warps).toContain("swirl");
		expect(warps).toContain("ripple");
	});

	it("doesn't file an uncurated effect under the default family", () => {
		expect(effectMatchesSearch({ id: "mask", name: "Mask" }, "displace")).toBe(
			false,
		);
	});

	it("matches everything on an empty query", () => {
		expect(names("  ")).toHaveLength(EFFECT_DEFINITIONS.length);
	});
});
