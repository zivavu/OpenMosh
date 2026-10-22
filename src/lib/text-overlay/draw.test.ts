import { describe, expect, it } from "bun:test";
import { wrapText } from "./draw";

/** Every character one unit wide. */
const width = (s: string) => [...s].length;

describe("wrapText", () => {
	it("breaks between words", () => {
		expect(wrapText("one two three", 8, width)).toEqual(["one two", "three"]);
	});

	it("keeps explicit line breaks and drops blank lines", () => {
		expect(wrapText("a\n\nb  c", 10, width)).toEqual(["a", "b c"]);
	});

	it("wraps Chinese, which has no spaces", () => {
		const lines = wrapText("我们今天去公园散步然后回家吃饭", 6, width);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((l) => width(l) <= 6)).toBe(true);
		expect(lines.join("")).toBe("我们今天去公园散步然后回家吃饭");
	});

	it("breaks a word too long for any line", () => {
		const lines = wrapText("see https://example.com/a/long/path", 10, width);
		expect(lines.every((l) => width(l) <= 10)).toBe(true);
		expect(lines.join("").replace(/ /g, "")).toBe(
			"seehttps://example.com/a/long/path",
		);
	});
});
